//! Remote control: lets a phone or another computer continue Opal sessions. Owner: runtime.
//!
//! While remote control is on:
//!  * the sidecar listens on `0.0.0.0:<sidecarPort>` (sidecar.rs asks `sidecar_bind`), with `--cors` for every
//!    origin this module serves the web UI from, and a password persisted in `<root>/remote/secret` (0600) so
//!    pairing tokens — HMAC-signed with the server password by OpenCode (server/src/auth.ts) — survive
//!    restarts. Turning remote control off deletes the secret, which revokes every paired device.
//!  * a tiny static HTTP/1.1 server (GET/HEAD only, `Connection: close`) serves the built frontend on
//!    `0.0.0.0:<webPort>`: the same files the webview loads, read through Tauri's asset resolver (embedded in
//!    release, `frontendDist` in dev) or proxied from the Vite dev server when it is running. It serves only
//!    public frontend assets — no credentials; the browser redeems a one-time pairing code itself
//!    (`/#rc=<payload>` → `GET <sidecar>/auth/connect/<code>`, see src/lib/opencode/remote-pairing.ts).
//!
//! Ports are stable (stored in `<root>/remote/config.json`) so a home-screen bookmark keeps working.
use crate::paths::OpalPaths;
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const DEFAULT_WEB_PORT: u16 = 47800;
pub const DEFAULT_SIDECAR_PORT: u16 = 47801;
const MAX_REQUEST_HEAD: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConfig {
    pub enabled: bool,
    /// Listen on every network interface (LAN, Tailscale…). Off = loopback only (for ssh -L / tunnels).
    pub lan: bool,
    pub web_port: u16,
    pub sidecar_port: u16,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            lan: true,
            web_port: DEFAULT_WEB_PORT,
            sidecar_port: DEFAULT_SIDECAR_PORT,
        }
    }
}

impl RemoteConfig {
    fn host(&self) -> &'static str {
        if self.lan { "0.0.0.0" } else { "127.0.0.1" }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    pub lan: bool,
    /// Non-loopback IPv4 addresses of this Mac (best first).
    #[serde(rename = "lanIPs")]
    pub lan_ips: Vec<String>,
    /// Bonjour name (`<LocalHostName>.local`), when known.
    pub host_name: Option<String>,
    pub web_port: u16,
    pub sidecar_port: u16,
    /// `http://<first LAN IP>:<sidecar port>` of the running sidecar (None when off / not running).
    #[serde(rename = "sidecarURL")]
    pub sidecar_url: Option<String>,
    /// `http://<first LAN IP>:<web port>` while the web server runs.
    #[serde(rename = "webURL")]
    pub web_url: Option<String>,
    pub web_running: bool,
    /// The Mac's addresses changed since the sidecar started (its CORS list is stale → restart).
    pub network_changed: bool,
}

/// What sidecar.rs needs to spawn a remote-reachable server.
pub struct SidecarBind {
    pub hostname: String,
    pub port: u16,
    pub password: String,
    pub cors: Vec<String>,
}

struct WebServer {
    port: u16,
    host: &'static str,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct RemoteState {
    web: Mutex<Option<WebServer>>,
    /// CORS origins the running sidecar was started with.
    spawned_origins: Mutex<Vec<String>>,
}

fn remote_dir(paths: &OpalPaths) -> PathBuf {
    paths.root.join("remote")
}

pub fn read_config(paths: &OpalPaths) -> RemoteConfig {
    std::fs::read_to_string(remote_dir(paths).join("config.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_config(paths: &OpalPaths, config: &RemoteConfig) -> anyhow::Result<()> {
    crate::config::write_json_atomic(
        &remote_dir(paths).join("config.json"),
        &serde_json::to_value(config)?,
    )
}

fn secret_file(paths: &OpalPaths) -> PathBuf {
    remote_dir(paths).join("secret")
}

/// The persisted server password while remote control is on (created on first use, mode 0600).
fn ensure_secret(paths: &OpalPaths) -> anyhow::Result<String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = secret_file(paths);
    if let Ok(s) = std::fs::read_to_string(&file) {
        let s = s.trim().to_string();
        if s.len() >= 32 {
            return Ok(s);
        }
    }
    let dir = remote_dir(paths);
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    let bytes: [u8; 32] = rand::random();
    let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let tmp = file.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(secret.as_bytes())?;
    }
    std::fs::rename(&tmp, &file)?;
    Ok(secret)
}

fn delete_secret(paths: &OpalPaths) {
    let _ = std::fs::remove_file(secret_file(paths));
}

/// Non-loopback, non-link-local IPv4 addresses of interfaces that are up. Wi-Fi/Ethernet (`en*`) first.
pub fn lan_ips() -> Vec<String> {
    let mut found: Vec<(String, Ipv4Addr)> = Vec::new();
    // SAFETY: getifaddrs/freeifaddrs pair; every pointer is checked before it is dereferenced.
    unsafe {
        let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut head) != 0 {
            return Vec::new();
        }
        let mut cur = head;
        while !cur.is_null() {
            let ifa = &*cur;
            cur = ifa.ifa_next;
            if ifa.ifa_addr.is_null() || (ifa.ifa_flags & libc::IFF_UP as u32) == 0 {
                continue;
            }
            if (*ifa.ifa_addr).sa_family as i32 != libc::AF_INET {
                continue;
            }
            let sin = &*(ifa.ifa_addr as *const libc::sockaddr_in);
            let ip = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
            if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() {
                continue;
            }
            let name = std::ffi::CStr::from_ptr(ifa.ifa_name)
                .to_string_lossy()
                .into_owned();
            found.push((name, ip));
        }
        libc::freeifaddrs(head);
    }
    found.sort_by_key(|(name, ip)| (!name.starts_with("en"), !ip.is_private(), name.clone()));
    let mut out: Vec<String> = Vec::new();
    for (_, ip) in found {
        let s = ip.to_string();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// `<LocalHostName>.local` (Bonjour), e.g. `My-MacBook-Pro.local`.
pub fn bonjour_name() -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "LocalHostName"])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let valid = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    valid.then(|| format!("{name}.local"))
}

/// Origins the web UI is reachable at (each must be passed to the sidecar as `--cors`).
pub fn web_origins(config: &RemoteConfig) -> Vec<String> {
    let mut hosts = if config.lan { lan_ips() } else { Vec::new() };
    if config.lan {
        hosts.extend(bonjour_name());
    }
    hosts
        .into_iter()
        .map(|h| format!("http://{h}:{}", config.web_port))
        .collect()
}

fn port_free(host: &str, port: u16) -> bool {
    std::net::TcpListener::bind((host, port)).is_ok()
}

fn any_free_port(host: &str) -> std::io::Result<u16> {
    Ok(std::net::TcpListener::bind((host, 0))?.local_addr()?.port())
}

/// Called by the sidecar supervisor before every spawn. None = default private loopback server.
pub async fn sidecar_bind<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<SidecarBind> {
    let paths = OpalPaths::resolve().ok()?;
    let mut config = read_config(&paths);
    if !config.enabled {
        if let Ok(mut o) = app.state::<RemoteState>().spawned_origins.lock() {
            o.clear();
        }
        return None;
    }
    let password = match ensure_secret(&paths) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("remote control: cannot create the server secret ({e}); staying local");
            return None;
        }
    };
    // A restart races the previous process releasing the port; give it a moment before moving.
    let mut port = config.sidecar_port;
    let mut waited = Duration::ZERO;
    while !port_free(config.host(), port) && waited < Duration::from_secs(4) {
        tokio::time::sleep(Duration::from_millis(200)).await;
        waited += Duration::from_millis(200);
    }
    if !port_free(config.host(), port) {
        port = any_free_port(config.host()).ok()?;
        log::warn!(
            "remote control: port {} busy, using {port}",
            config.sidecar_port
        );
        config.sidecar_port = port;
        let _ = write_config(&paths, &config);
    }
    let cors = web_origins(&config);
    if let Ok(mut o) = app.state::<RemoteState>().spawned_origins.lock() {
        *o = cors.clone();
    }
    Some(SidecarBind {
        hostname: config.host().to_string(),
        port,
        password,
        cors,
    })
}

// ---------- static web server ----------

fn content_type(path: &str, fallback: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "webmanifest" => "application/manifest+json".into(),
        "html" => "text/html; charset=utf-8".into(),
        "js" | "mjs" => "text/javascript; charset=utf-8".into(),
        "css" => "text/css; charset=utf-8".into(),
        "json" => "application/json".into(),
        "svg" => "image/svg+xml".into(),
        "wasm" => "application/wasm".into(),
        _ if !fallback.is_empty() => fallback.into(),
        _ => mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string(),
    }
}

/// Decodes and validates a request path; None for traversal attempts.
fn clean_path(raw: &str) -> Option<String> {
    let path = raw.split(['?', '#']).next().unwrap_or("/");
    let decoded = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .ok()?;
    if decoded
        .split('/')
        .any(|seg| seg == ".." || seg.contains('\\'))
        || decoded.contains('\0')
    {
        return None;
    }
    let trimmed = decoded.trim_start_matches('/');
    Some(if trimmed.is_empty() {
        "index.html".into()
    } else {
        trimmed.to_string()
    })
}

struct Response {
    status: &'static str,
    content_type: String,
    body: Vec<u8>,
    cache: &'static str,
}

impl Response {
    fn text(status: &'static str, body: &str) -> Self {
        Self {
            status,
            content_type: "text/plain; charset=utf-8".into(),
            body: body.as_bytes().to_vec(),
            cache: "no-store",
        }
    }
}

/// `path` is the cleaned asset path; `target` the raw request target (with query, which Vite needs: `?raw`, `?import`).
async fn resolve_asset(app: &AppHandle, path: &str, target: &str) -> Response {
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    // Dev: serve the live Vite build when it is running (falls back to frontendDist below).
    if tauri::is_dev() {
        if let Some(dev) = app.config().build.dev_url.clone() {
            let url = format!(
                "{}/{}",
                dev.as_str().trim_end_matches('/'),
                target.trim_start_matches('/')
            );
            if let Ok(res) = reqwest::Client::new()
                .get(&url)
                .timeout(Duration::from_secs(10))
                .send()
                .await
            {
                if res.status().is_success() {
                    let ct = res
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    if let Ok(body) = res.bytes().await {
                        return Response {
                            status: "200 OK",
                            // Vite serves transformed modules (e.g. `index.css` as JS): trust its content type.
                            content_type: if ct.is_empty() {
                                content_type(path, "")
                            } else {
                                ct
                            },
                            body: body.to_vec(),
                            cache: "no-store",
                        };
                    }
                }
            }
        }
    }
    match app.asset_resolver().get(path.to_string()) {
        Some(asset) => {
            // The resolver falls back to index.html for unknown paths (SPA routing).
            let served_html = asset.mime_type.starts_with("text/html");
            Response {
                status: "200 OK",
                content_type: if served_html {
                    "text/html; charset=utf-8".into()
                } else {
                    content_type(path, &asset.mime_type)
                },
                body: asset.bytes,
                cache: if served_html { "no-cache" } else { cache },
            }
        }
        None => Response::text("404 Not Found", "Not found"),
    }
}

async fn handle_connection(app: AppHandle, mut stream: tokio::net::TcpStream) {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    let head_end = loop {
        let read = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut chunk)).await;
        let n = match read {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return,
            Ok(Ok(n)) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_REQUEST_HEAD {
            return;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
    let upgrade = head
        .lines()
        .any(|l| l.to_ascii_lowercase().starts_with("upgrade:"));
    let response = match (method, clean_path(target)) {
        // No WebSockets here (the Vite HMR client falls back gracefully).
        _ if upgrade => Response::text("400 Bad Request", "WebSocket upgrades are not supported"),
        ("GET" | "HEAD", Some(path)) => resolve_asset(&app, &path, target).await,
        ("GET" | "HEAD", None) => Response::text("400 Bad Request", "Bad request"),
        _ => Response::text("405 Method Not Allowed", "Method not allowed"),
    };
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: {}\r\n\
         X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\n\
         Connection: close\r\n\r\n",
        response.status,
        response.content_type,
        response.body.len(),
        response.cache
    );
    let _ = stream.write_all(header.as_bytes()).await;
    if method != "HEAD" {
        let _ = stream.write_all(&response.body).await;
    }
    let _ = stream.shutdown().await;
}

fn stop_web(app: &AppHandle) {
    if let Ok(mut slot) = app.state::<RemoteState>().web.lock() {
        if let Some(server) = slot.take() {
            server.task.abort();
            log::info!("remote web UI stopped (port {})", server.port);
        }
    }
}

/// (Re)starts the web server for `config`; moves to a free port (saved) when the configured one is taken.
async fn start_web(
    app: &AppHandle,
    paths: &OpalPaths,
    config: &mut RemoteConfig,
) -> Result<(), String> {
    let host = config.host();
    {
        let state = app.state::<RemoteState>();
        let slot = state.web.lock().map_err(|e| e.to_string())?;
        if let Some(s) = slot.as_ref() {
            if s.port == config.web_port && s.host == host && !s.task.inner().is_finished() {
                return Ok(());
            }
        }
    }
    stop_web(app);
    let listener = match tokio::net::TcpListener::bind((host, config.web_port)).await {
        Ok(l) => l,
        Err(_) => {
            let l = tokio::net::TcpListener::bind((host, 0))
                .await
                .map_err(|e| e.to_string())?;
            config.web_port = l.local_addr().map_err(|e| e.to_string())?.port();
            write_config(paths, config).map_err(|e| e.to_string())?;
            l
        }
    };
    let port = config.web_port;
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tauri::async_runtime::spawn(handle_connection(handle.clone(), stream));
                }
                Err(e) => {
                    log::warn!("remote web UI accept failed: {e}");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
    });
    log::info!("remote web UI listening on {host}:{port}");
    if let Ok(mut slot) = app.state::<RemoteState>().web.lock() {
        *slot = Some(WebServer { port, host, task });
    }
    Ok(())
}

/// Starts the web server at launch when remote control was left on.
pub fn setup(app: &tauri::App) {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let Ok(paths) = OpalPaths::resolve() else {
            return;
        };
        let mut config = read_config(&paths);
        if config.enabled {
            if let Err(e) = start_web(&handle, &paths, &mut config).await {
                log::warn!("remote web UI failed to start: {e}");
            }
        }
    });
}

fn running_sidecar_port(app: &AppHandle) -> Option<u16> {
    let state = app.state::<crate::sidecar::SidecarState>();
    let conn = state.connection.lock().ok()?.clone()?;
    conn.url
        .rsplit(':')
        .next()?
        .trim_end_matches('/')
        .parse()
        .ok()
}

fn status(app: &AppHandle, paths: &OpalPaths) -> RemoteStatus {
    let config = read_config(paths);
    let lan_ips = if config.lan { lan_ips() } else { Vec::new() };
    let primary = lan_ips
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".into());
    let state = app.state::<RemoteState>();
    let web_port = state.web.lock().ok().and_then(|w| {
        w.as_ref()
            .filter(|s| !s.task.inner().is_finished())
            .map(|s| s.port)
    });
    let sidecar_port = config.enabled.then(|| running_sidecar_port(app)).flatten();
    let spawned = state
        .spawned_origins
        .lock()
        .map(|o| o.clone())
        .unwrap_or_default();
    let network_changed = config.enabled && sidecar_port.is_some() && {
        let mut now = web_origins(&config);
        let mut then = spawned;
        now.sort();
        then.sort();
        now != then
    };
    RemoteStatus {
        enabled: config.enabled,
        lan: config.lan,
        host_name: bonjour_name(),
        web_port: config.web_port,
        sidecar_port: sidecar_port.unwrap_or(config.sidecar_port),
        sidecar_url: sidecar_port.map(|p| format!("http://{primary}:{p}")),
        web_url: web_port.map(|p| format!("http://{primary}:{p}")),
        web_running: web_port.is_some(),
        network_changed,
        lan_ips,
    }
}

#[tauri::command]
pub async fn cmd_remote_status(app: AppHandle) -> Result<RemoteStatus, String> {
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    Ok(status(&app, &paths))
}

/// Turns remote control on/off (or switches LAN listening). Restarts the sidecar when its binding changes.
#[tauri::command]
pub async fn cmd_remote_configure(
    app: AppHandle,
    enabled: bool,
    lan: bool,
) -> Result<RemoteStatus, String> {
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    let before = read_config(&paths);
    let mut config = RemoteConfig {
        enabled,
        lan,
        ..before.clone()
    };
    write_config(&paths, &config).map_err(|e| e.to_string())?;
    if enabled {
        ensure_secret(&paths).map_err(|e| e.to_string())?;
        start_web(&app, &paths, &mut config).await?;
    } else {
        stop_web(&app);
        // Revokes every paired device: their session tokens are signed with this secret.
        delete_secret(&paths);
    }
    let rebind = before.enabled != config.enabled || (enabled && before.lan != config.lan);
    let stale = status(&app, &paths).network_changed;
    if rebind || stale {
        crate::sidecar::restart(&app);
    }
    Ok(status(&app, &paths))
}

/// Rotates the remote secret (revoking every paired device) and restarts the sidecar.
#[tauri::command]
pub async fn cmd_remote_revoke(app: AppHandle) -> Result<RemoteStatus, String> {
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    delete_secret(&paths);
    if read_config(&paths).enabled {
        ensure_secret(&paths).map_err(|e| e.to_string())?;
        crate::sidecar::restart(&app);
    }
    Ok(status(&app, &paths))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_path_rejects_traversal() {
        assert_eq!(clean_path("/").as_deref(), Some("index.html"));
        assert_eq!(
            clean_path("/assets/a.js?v=1#x").as_deref(),
            Some("assets/a.js")
        );
        assert_eq!(clean_path("/%2e%2e/secret"), None);
        assert_eq!(clean_path("/a/../b"), None);
    }

    #[test]
    fn content_types() {
        assert_eq!(
            content_type("manifest.webmanifest", ""),
            "application/manifest+json"
        );
        assert_eq!(
            content_type("assets/x.js", "application/octet-stream"),
            "text/javascript; charset=utf-8"
        );
    }

    #[test]
    fn config_defaults_and_partial_json() {
        let c: RemoteConfig = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(c.enabled && c.lan);
        assert_eq!(c.web_port, DEFAULT_WEB_PORT);
        assert_eq!(c.host(), "0.0.0.0");
    }

    #[test]
    fn lan_ips_are_not_loopback() {
        assert!(lan_ips().iter().all(|ip| !ip.starts_with("127.")));
    }
}
