//! In-app acceptance smoke harness support (see src/lib/smoke and scripts/smoke-mac.sh).
//!
//! `OPAL_SMOKE` (inline JSON or a path to a JSON file) switches the frontend into a scripted run of the
//! primary workflow against the real sidecar. Without the variable every command here is inert:
//! `cmd_smoke_config` returns None and the webview never calls the others.
//!
//!   cmd_smoke_config          parsed OPAL_SMOKE value
//!   cmd_smoke_report          writes <logs>/smoke-<name>.json (pretty, atomic); optionally stops the sidecar
//!                             and exits with 0, or 1 when `report.ok === false`
//!   cmd_smoke_artifact_file   resolves an artifact file exactly like the `artifact://` handler
//!   cmd_smoke_stat            whether a path exists (sandbox directory checks)
use crate::config::{read_json, write_json_atomic};
use crate::paths::OpalPaths;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

const ENV: &str = "OPAL_SMOKE";
/// Path-segment encoding: everything except RFC 3986 unreserved characters.
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// Parses the OPAL_SMOKE value: inline JSON when it starts with `{`, otherwise a file path.
pub(crate) fn parse_config(raw: &str) -> Result<serde_json::Value, String> {
    let raw = raw.trim();
    if raw.starts_with('{') {
        return serde_json::from_str(raw).map_err(|e| format!("{ENV}: invalid JSON: {e}"));
    }
    match read_json(Path::new(raw)) {
        Ok(Some(value)) => Ok(value),
        Ok(None) => Err(format!("{ENV}: file not found: {raw}")),
        Err(e) => Err(format!("{ENV}: {raw}: {e}")),
    }
}

/// Report names become file names: keep them to `[A-Za-z0-9_-]{1,64}`.
pub(crate) fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub(crate) fn exit_code(report: &serde_json::Value) -> i32 {
    if report.get("ok") == Some(&serde_json::Value::Bool(false)) { 1 } else { 0 }
}

#[tauri::command]
pub async fn cmd_smoke_config() -> Result<Option<serde_json::Value>, String> {
    match std::env::var(ENV) {
        Ok(raw) if !raw.trim().is_empty() => parse_config(&raw).map(Some),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn cmd_smoke_report(
    app: tauri::AppHandle,
    name: String,
    report: serde_json::Value,
    exit: bool,
) -> Result<String, String> {
    if !is_safe_name(&name) {
        return Err(format!("invalid report name: {name}"));
    }
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    let file = paths.logs_dir.join(format!("smoke-{name}.json"));
    write_json_atomic(&file, &report).map_err(|e| e.to_string())?;
    log::info!("smoke report written to {}", file.display());
    if exit {
        let code = exit_code(&report);
        // Let the invoke response reach the webview before the process goes away.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            crate::sidecar::shutdown(&app);
            app.exit(code);
        });
    }
    Ok(file.to_string_lossy().into_owned())
}

#[derive(Debug, Serialize)]
pub struct SmokeFile {
    pub status: u16,
    pub mime: String,
    pub bytes: usize,
}

/// `artifact://localhost/<artifact_id>/<path>` resolved through the protocol's own resolver.
#[tauri::command]
pub async fn cmd_smoke_artifact_file(artifact_id: String, path: String) -> Result<SmokeFile, String> {
    let encoded: Vec<String> =
        path.split('/').map(|s| utf8_percent_encode(s, SEGMENT).to_string()).collect();
    let raw = format!("/{}/{}", utf8_percent_encode(&artifact_id, SEGMENT), encoded.join("/"));
    Ok(match crate::artifact_protocol::resolve_request(&raw) {
        crate::artifact_protocol::Resolved::File { bytes, type_path } => SmokeFile {
            status: 200,
            mime: crate::artifact_protocol::content_type_for(&type_path),
            bytes: bytes.len(),
        },
        crate::artifact_protocol::Resolved::Error { status, message } => SmokeFile {
            status: status.as_u16(),
            mime: format!("error: {message}"),
            bytes: 0,
        },
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeStat {
    pub exists: bool,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn cmd_smoke_stat(path: String) -> Result<SmokeStat, String> {
    let meta = std::fs::metadata(&path).ok();
    Ok(SmokeStat { exists: meta.is_some(), is_dir: meta.map(|m| m.is_dir()).unwrap_or(false) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_inline_and_file_configs() {
        assert_eq!(parse_config(r#" {"name":"a"} "#).unwrap(), serde_json::json!({ "name": "a" }));
        assert!(parse_config("{nope").is_err());
        let dir = std::env::temp_dir().join(format!("opal-smoke-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("smoke.json");
        std::fs::write(&file, r#"{"name":"b","phase":"create"}"#).unwrap();
        assert_eq!(parse_config(file.to_str().unwrap()).unwrap()["phase"], "create");
        assert!(parse_config(dir.join("missing.json").to_str().unwrap()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn names_and_exit_codes() {
        assert!(is_safe_name("accept-reopen_1"));
        for bad in ["", "../x", "a/b", "a.json", "a b"] {
            assert!(!is_safe_name(bad), "{bad}");
        }
        assert_eq!(exit_code(&serde_json::json!({ "ok": true })), 0);
        assert_eq!(exit_code(&serde_json::json!({ "ok": false })), 1);
        assert_eq!(exit_code(&serde_json::json!({})), 0);
    }
}
