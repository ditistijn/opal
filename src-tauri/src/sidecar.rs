//! Spawns and supervises the private `opencode serve` sidecar. Owner: runtime.
//!
//! Lifecycle: `setup` starts a supervisor task that resolves the binary, picks a free port and a
//! random password, spawns `opencode serve --hostname 127.0.0.1 --port <p>` with Opal's isolated
//! XDG directories, waits for `GET /api/info`, publishes the connection and emits `server:status`.
//! With remote control on (remote_web.rs) it binds `0.0.0.0` on a stable port with a persisted password and
//! `--cors` for each LAN origin of the Opal web UI; the webview still connects over 127.0.0.1.
//! If the process dies the supervisor restarts it with exponential backoff. The child runs in its
//! own process group and is killed on app exit and on `cmd_server_restart`.
//!
//! The password is generated here, passed only through the child's environment and returned to
//! the webview via `cmd_server_connection`; it is never logged (log lines are also redacted).
use crate::paths::OpalPaths;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const LOG_CAPACITY: usize = 500;
const LOG_FILE_MAX_BYTES: u64 = 5 * 1024 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(60);
const STATUS_EVENT: &str = "server:status";
const USERNAME: &str = "opencode";

#[derive(Debug, Clone, Serialize)]
pub struct ServerConnection {
    pub url: String,
    /// Basic-auth password (username is "opencode"). Lives in memory only.
    pub password: String,
    pub version: Option<String>,
}

/// Payload of the `server:status` event; mirrors `ServerStatus` in src/lib/runtime/contracts.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum ServerStatus {
    Starting {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Ready {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
    },
    Error {
        message: String,
        logs: Vec<String>,
    },
}

#[derive(Default)]
pub struct SidecarState {
    pub connection: Mutex<Option<ServerConnection>>,
    pub logs: Mutex<VecDeque<String>>,
    child: Mutex<Option<CommandChild>>,
    /// Bumped on every intentional stop/restart; a supervisor whose generation is stale exits.
    generation: AtomicU64,
    shutting_down: AtomicBool,
    /// Current password, kept only to redact it from log lines.
    secret: Mutex<Option<String>>,
}

impl SidecarState {
    fn push_log(&self, paths: Option<&OpalPaths>, line: &str) {
        let line = match self.secret.lock().ok().and_then(|s| s.clone()) {
            Some(secret) if !secret.is_empty() => line.replace(&secret, "••••"),
            _ => line.to_string(),
        };
        if let Ok(mut logs) = self.logs.lock() {
            if logs.len() >= LOG_CAPACITY {
                logs.pop_front();
            }
            logs.push_back(line.clone());
        }
        if let Some(paths) = paths {
            append_log_file(&paths.logs_dir.join("opencode.log"), &line);
        }
    }

    fn recent_logs(&self, n: usize) -> Vec<String> {
        self.logs
            .lock()
            .map(|logs| logs.iter().rev().take(n).rev().cloned().collect())
            .unwrap_or_default()
    }

    fn kill_child(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }
    }
}

pub fn setup(app: &mut tauri::App) -> anyhow::Result<()> {
    let paths = OpalPaths::resolve()?;
    ensure_opencode_config(&paths)?;
    kill_stale_sidecar(&paths);
    // Kill the child when the app exits (Cmd+Q, last window closed, process plugin exit).
    app.handle().plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("opal-sidecar")
            .on_event(|app, event| {
                if let RunEvent::Exit = event {
                    shutdown(app);
                }
            })
            .build(),
    )?;
    // SIGINT/SIGTERM/SIGHUP bypass RunEvent::Exit and the sidecar runs in its own process group,
    // so stop it explicitly (SIGKILL of the app is covered by the pidfile cleanup on next launch).
    #[cfg(unix)]
    {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            use tokio::signal::unix::{signal, SignalKind};
            let (Ok(mut int), Ok(mut term), Ok(mut hup)) = (
                signal(SignalKind::interrupt()),
                signal(SignalKind::terminate()),
                signal(SignalKind::hangup()),
            ) else {
                log::warn!(
                    "could not install signal handlers; the sidecar may outlive a killed app"
                );
                return;
            };
            tokio::select! {
                _ = int.recv() => {}
                _ = term.recv() => {}
                _ = hup.recv() => {}
            }
            log::info!("signal received; stopping the sidecar");
            shutdown(&handle);
            handle.exit(0);
        });
    }
    let handle = app.handle().clone();
    let generation = app
        .state::<SidecarState>()
        .generation
        .load(Ordering::SeqCst);
    tauri::async_runtime::spawn(supervise(handle, generation));
    Ok(())
}

/// Stops the sidecar for good (app exit, signals, and the smoke harness via smoke.rs).
pub(crate) fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SidecarState>();
    state.shutting_down.store(true, Ordering::SeqCst);
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.kill_child();
    if let Ok(paths) = OpalPaths::resolve() {
        let _ = std::fs::remove_file(pid_file(&paths));
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, status: ServerStatus) {
    let _ = app.emit(STATUS_EVENT, status);
}

fn is_current<R: Runtime>(app: &AppHandle<R>, generation: u64) -> bool {
    let state = app.state::<SidecarState>();
    !state.shutting_down.load(Ordering::SeqCst)
        && state.generation.load(Ordering::SeqCst) == generation
}

/// Keeps one sidecar alive for `generation`, restarting it with backoff when it exits.
async fn supervise<R: Runtime>(app: AppHandle<R>, generation: u64) {
    let mut backoff = Duration::from_secs(1);
    while is_current(&app, generation) {
        emit_status(
            &app,
            ServerStatus::Starting {
                message: Some("Starting engine…".into()),
            },
        );
        let started = Instant::now();
        let outcome = run_once(&app, generation).await;
        if !is_current(&app, generation) {
            return;
        }
        let state = app.state::<SidecarState>();
        if let Ok(mut c) = state.connection.lock() {
            *c = None;
        }
        let message = match outcome {
            Ok(exit) => format!("OpenCode exited unexpectedly ({exit})"),
            Err(e) => e,
        };
        log::warn!("sidecar: {message}");
        emit_status(
            &app,
            ServerStatus::Error {
                message,
                logs: state.recent_logs(40),
            },
        );
        // A run that stayed healthy for a while resets the backoff.
        if started.elapsed() > Duration::from_secs(60) {
            backoff = Duration::from_secs(1);
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}

/// Spawns one sidecar, waits until it is healthy, then waits for it to exit.
/// Ok(description of the exit) when it ran and terminated; Err when it never became ready.
async fn run_once<R: Runtime>(app: &AppHandle<R>, generation: u64) -> Result<String, String> {
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    ensure_opencode_config(&paths).map_err(|e| e.to_string())?;
    let binary = resolve_binary().ok_or_else(|| {
        "OpenCode binary not found (bundled sidecar, ~/.opencode/bin/opencode or PATH)".to_string()
    })?;
    // Remote control (remote_web.rs) binds every interface with a stable port + persisted password.
    let remote = crate::remote_web::sidecar_bind(app).await;
    let (hostname, port, password, cors) = match remote {
        Some(bind) => (bind.hostname, bind.port, bind.password, bind.cors),
        None => (
            "127.0.0.1".to_string(),
            free_port().map_err(|e| format!("no free port: {e}"))?,
            random_password(),
            Vec::new(),
        ),
    };
    // The webview always talks to the sidecar over loopback (a 0.0.0.0 bind includes it).
    let url = format!("http://127.0.0.1:{port}");
    let state = app.state::<SidecarState>();
    if let Ok(mut s) = state.secret.lock() {
        *s = Some(password.clone());
    }
    state.push_log(
        Some(&paths),
        &format!(
            "[opal] spawning {} serve on {hostname}:{port}{}",
            binary.display(),
            if cors.is_empty() { String::new() } else { format!(" (remote control; cors {})", cors.join(", ")) }
        ),
    );

    let mut args: Vec<String> = vec![
        "serve".into(),
        "--hostname".into(),
        hostname.clone(),
        "--port".into(),
        port.to_string(),
    ];
    for origin in &cors {
        args.push("--cors".into());
        args.push(origin.clone());
    }
    let command = app
        .shell()
        .command(&binary)
        .args(args)
        .current_dir(&paths.root)
        .env_clear()
        .envs(sidecar_env(&paths, &password))
        .set_process_group(true)
        .kill_on_drop(true);
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to spawn OpenCode: {e}"))?;
    write_pid_file(&paths, child.pid());
    if let Ok(mut slot) = state.child.lock() {
        if let Some(old) = slot.replace(child) {
            let _ = old.kill();
        }
    }

    let (exit_tx, mut exit_rx) = tokio::sync::oneshot::channel::<String>();
    let pump_app = app.clone();
    let pump_paths = paths.clone();
    tauri::async_runtime::spawn(async move {
        let state = pump_app.state::<SidecarState>();
        let mut exit_tx = Some(exit_tx);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        state.push_log(Some(&pump_paths), line);
                    }
                }
                CommandEvent::Error(e) => {
                    state.push_log(Some(&pump_paths), &format!("[opal] error: {e}"))
                }
                CommandEvent::Terminated(p) => {
                    let desc = match (p.code, p.signal) {
                        (Some(code), _) => format!("exit code {code}"),
                        (None, Some(sig)) => format!("signal {sig}"),
                        _ => "unknown status".to_string(),
                    };
                    state.push_log(
                        Some(&pump_paths),
                        &format!("[opal] OpenCode terminated: {desc}"),
                    );
                    if let Some(tx) = exit_tx.take() {
                        let _ = tx.send(desc);
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + READY_TIMEOUT;
    let version = loop {
        if !is_current(app, generation) {
            return Ok("stopped".into());
        }
        if let Ok(desc) = exit_rx.try_recv() {
            return Err(format!("OpenCode exited before it was ready ({desc})"));
        }
        if Instant::now() > deadline {
            state.kill_child();
            return Err(format!(
                "OpenCode did not become ready within {}s",
                READY_TIMEOUT.as_secs()
            ));
        }
        match probe_info(&client, &url, &password).await {
            Some(version) => break version,
            None => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    };

    if let Ok(mut c) = state.connection.lock() {
        *c = Some(ServerConnection {
            url: url.clone(),
            password,
            version: version.clone(),
        });
    }
    state.push_log(Some(&paths), &format!("[opal] OpenCode ready on {url}"));
    log::info!("sidecar ready on {url}");
    // Agent shell commands must not be able to talk to the engine (or the remote-control web server) over loopback.
    let mut deny = vec![crate::remote_web::DEFAULT_WEB_PORT, crate::remote_web::DEFAULT_SIDECAR_PORT];
    if let Some(port) = url.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) {
        deny.push(port);
    }
    crate::sandbox_exec::publish_deny_ports(&deny);
    emit_status(app, ServerStatus::Ready { url, version });

    Ok((&mut exit_rx)
        .await
        .unwrap_or_else(|_| "process handle dropped".into()))
}

/// `GET /api/info` with Basic auth; returns Some(version) on 200.
async fn probe_info(client: &reqwest::Client, url: &str, password: &str) -> Option<Option<String>> {
    let res = client
        .get(format!("{url}/api/info"))
        .basic_auth(USERNAME, Some(password))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    Some(
        body.get("version")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    )
}

/// Environment for the child: the parent's environment minus anything that could point OpenCode
/// at the user's own config or server, plus Opal's XDG roots and a PATH that works when the app is
/// launched from Finder (which only provides /usr/bin:/bin:/usr/sbin:/sbin).
fn sidecar_env(paths: &OpalPaths, password: &str) -> Vec<(String, String)> {
    const DROPPED: &[&str] = &[
        "OPENCODE_CONFIG",
        "OPENCODE_CONFIG_DIR",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_PASSWORD",
        "OPENCODE_SERVER_URL",
    ];
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(k, _)| !DROPPED.contains(&k.as_str()) && !k.starts_with("XDG_"))
        .filter(|(k, _)| k != "PATH")
        .collect();
    env.push(("PATH".into(), augmented_path()));
    env.push(("OPENCODE_PASSWORD".into(), password.into()));
    env.push(("OPENCODE_CLIENT".into(), "opal".into()));
    for (key, dir) in [
        ("XDG_DATA_HOME", &paths.xdg_data),
        ("XDG_CONFIG_HOME", &paths.xdg_config),
        ("XDG_CACHE_HOME", &paths.xdg_cache),
        ("XDG_STATE_HOME", &paths.xdg_state),
    ] {
        env.push((key.into(), dir.to_string_lossy().into_owned()));
    }
    env
}

fn augmented_path() -> String {
    let mut parts: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect();
    let home = dirs::home_dir()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extra = [
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.opencode/bin"),
        format!("{home}/.local/bin"),
        format!("{home}/.bun/bin"),
        format!("{home}/.cargo/bin"),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    for p in extra {
        if !parts.contains(&p) {
            parts.push(p);
        }
    }
    parts.join(":")
}

/// Bundled externalBin sidecar (next to the app executable) → ~/.opencode/bin/opencode → PATH.
pub fn resolve_binary() -> Option<PathBuf> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("opencode")));
    let home = dirs::home_dir().map(|h| h.join(".opencode").join("bin").join("opencode"));
    bundled
        .into_iter()
        .chain(home)
        .find(|p| is_executable(p))
        .or_else(|| which::which("opencode").ok())
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

fn free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

/// 32 random bytes, hex-encoded.
fn random_password() -> String {
    let bytes: [u8; 32] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes a minimal opencode.json if none exists yet; the TypeScript side regenerates the full one.
pub fn ensure_opencode_config(paths: &OpalPaths) -> anyhow::Result<()> {
    if paths.opencode_config_file.exists() {
        return Ok(());
    }
    let minimal = serde_json::json!({ "experimental": { "artifacts": true } });
    crate::config::write_json_atomic(&paths.opencode_config_file, &minimal)
}

fn pid_file(paths: &OpalPaths) -> PathBuf {
    paths.logs_dir.join("opencode.pid")
}

fn write_pid_file(paths: &OpalPaths, pid: u32) {
    let _ = std::fs::write(pid_file(paths), pid.to_string());
}

/// A previous Opal run that crashed may have left its sidecar running; stop it (only if it is
/// still an `opencode` process — the pid may have been reused).
fn kill_stale_sidecar(paths: &OpalPaths) {
    let Ok(pid) = std::fs::read_to_string(pid_file(paths)) else {
        return;
    };
    let Ok(pid) = pid.trim().parse::<u32>() else {
        return;
    };
    let comm = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    if comm.contains("opencode") {
        // The sidecar leads its own process group, so signal the whole group.
        let _ = std::process::Command::new("kill")
            .args(["-TERM", "--", &format!("-{pid}")])
            .status();
    }
    let _ = std::fs::remove_file(pid_file(paths));
}

fn append_log_file(path: &Path, line: &str) {
    if std::fs::metadata(path)
        .map(|m| m.len() > LOG_FILE_MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "{ts} {line}");
    }
}

#[tauri::command]
pub async fn cmd_server_connection(
    state: tauri::State<'_, SidecarState>,
) -> Result<Option<ServerConnection>, String> {
    Ok(state.connection.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub async fn cmd_server_restart(app: tauri::AppHandle) -> Result<(), String> {
    restart(&app);
    Ok(())
}

/// Stops the current sidecar and starts a new supervisor (new port/password unless remote control pins them).
pub fn restart(app: &tauri::AppHandle) {
    let state = app.state::<SidecarState>();
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.kill_child();
    if let Ok(mut c) = state.connection.lock() {
        *c = None;
    }
    if let Ok(paths) = OpalPaths::resolve() {
        state.push_log(Some(&paths), "[opal] restart requested");
    }
    tauri::async_runtime::spawn(supervise(app.clone(), generation));
}

#[tauri::command]
pub async fn cmd_server_logs(state: tauri::State<'_, SidecarState>) -> Result<Vec<String>, String> {
    Ok(state
        .logs
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .cloned()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_is_64_hex_chars() {
        let pw = random_password();
        assert_eq!(pw.len(), 64);
        assert!(pw.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(pw, random_password());
    }

    #[test]
    fn status_serializes_like_the_ts_contract() {
        let v = serde_json::to_value(ServerStatus::Ready {
            url: "http://x".into(),
            version: None,
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "state": "ready", "url": "http://x" })
        );
        let v = serde_json::to_value(ServerStatus::Starting { message: None }).unwrap();
        assert_eq!(v, serde_json::json!({ "state": "starting" }));
    }

    #[test]
    fn path_contains_homebrew() {
        assert!(augmented_path()
            .split(':')
            .any(|p| p == "/opt/homebrew/bin"));
    }
}
