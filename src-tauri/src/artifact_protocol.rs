//! `artifact://localhost/<artifactID>/<path>` → bytes from <artifacts_dir>/<artifactID>/<path>.
//! `artifact://localhost/<artifactID>@<n>/<path>` → bytes from version snapshot n (see versions.rs).
//! Also serves `artifact://localhost/_runtime/<file>` from the bundled public/artifact-runtime.
//! Owner: artifacts. Must never expose anything outside the artifact's own directory.
//!
//! Security rules (mirrored in docs/ARTIFACTS.md and tests/unit/artifacts/path-safety.test.ts):
//!   * the first segment must be `_runtime` or match `^art_[A-Za-z0-9_-]+(@[0-9]+)?$`
//!   * the remaining path is percent-decoded, then split on `/`; empty and `.` segments are dropped,
//!     `..`, NUL, `\` and `:` inside a segment are rejected (400)
//!   * the resolved file is canonicalized and must stay inside the canonical artifact directory
//!     (defeats symlinks that point elsewhere)
//!   * a directory (or the bare artifact root) resolves to `index.html`
//!   * responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; no CORS headers,
//!     no credentials, nothing from the main app origin.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::UriSchemeContext;

use crate::paths::OpalPaths;

/// Files of public/artifact-runtime embedded at compile time so release builds never depend on
/// where the frontend dist ends up inside the bundle. Keep in sync with public/artifact-runtime.
/// (`runtime_files_are_complete` test fails when a file is added on disk but not listed here.)
macro_rules! runtime_file {
    ($name:literal) => {
        ($name, include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/artifact-runtime/", $name)) as &[u8])
    };
}

pub(crate) static RUNTIME_FILES: &[(&str, &[u8])] = &[
    runtime_file!("runtime.js"),
    runtime_file!("runtime.css"),
    runtime_file!("error-bridge.js"),
    runtime_file!("react.html"),
    runtime_file!("react.js"),
    runtime_file!("markdown.html"),
    runtime_file!("markdown.js"),
    runtime_file!("mermaid.html"),
    runtime_file!("svg.html"),
    runtime_file!("csv.html"),
    runtime_file!("json.html"),
    runtime_file!("code.html"),
    runtime_file!("html.html"),
    runtime_file!("widget.html"),
    runtime_file!("vendor/sucrase.js"),
    runtime_file!("vendor/marked.js"),
    runtime_file!("vendor/hljs.js"),
    runtime_file!("shadcn/utils.js"),
    runtime_file!("shadcn/button.jsx"),
    runtime_file!("shadcn/card.jsx"),
    runtime_file!("shadcn/input.jsx"),
    runtime_file!("shadcn/textarea.jsx"),
    runtime_file!("shadcn/label.jsx"),
    runtime_file!("shadcn/badge.jsx"),
    runtime_file!("shadcn/alert.jsx"),
    runtime_file!("shadcn/separator.jsx"),
    runtime_file!("shadcn/progress.jsx"),
    runtime_file!("shadcn/switch.jsx"),
    runtime_file!("shadcn/checkbox.jsx"),
    runtime_file!("shadcn/slider.jsx"),
    runtime_file!("shadcn/tabs.jsx"),
    runtime_file!("shadcn/select.jsx"),
    runtime_file!("shadcn/table.jsx"),
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Target {
    /// A bundled renderer runtime file (relative path inside public/artifact-runtime).
    Runtime(String),
    /// A file of an artifact (live, or snapshot `version`), as normalized relative segments.
    Artifact { id: String, version: Option<u32>, segments: Vec<String> },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PathError {
    BadRequest(&'static str),
}

pub(crate) fn is_valid_artifact_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("art_") else { return false };
    !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Splits `art_x@3` into (`art_x`, Some(3)).
fn parse_id(raw: &str) -> Option<(String, Option<u32>)> {
    match raw.split_once('@') {
        None => is_valid_artifact_id(raw).then(|| (raw.to_string(), None)),
        Some((id, n)) => {
            if !is_valid_artifact_id(id) || n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            n.parse::<u32>().ok().map(|n| (id.to_string(), Some(n)))
        }
    }
}

/// Normalizes a decoded relative path into safe segments. Empty / `.` segments are dropped.
pub(crate) fn normalize_segments(path: &str) -> Result<Vec<String>, PathError> {
    if path.contains('\0') {
        return Err(PathError::BadRequest("path contains NUL"));
    }
    let mut out = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => continue,
            ".." => return Err(PathError::BadRequest("path traversal is not allowed")),
            s if s.contains('\\') || s.contains(':') => {
                return Err(PathError::BadRequest("path contains a forbidden character"));
            }
            s => out.push(s.to_string()),
        }
    }
    Ok(out)
}

/// Parses the (still percent-encoded) URI path of an `artifact://` request.
pub(crate) fn parse_request_path(raw_path: &str) -> Result<Target, PathError> {
    let decoded = percent_decode_str(raw_path)
        .decode_utf8()
        .map_err(|_| PathError::BadRequest("path is not valid UTF-8"))?;
    let trimmed = decoded.trim_start_matches('/');
    let (head, rest) = trimmed.split_once('/').unwrap_or((trimmed, ""));
    if head == "_runtime" {
        let segments = normalize_segments(rest)?;
        if segments.is_empty() {
            return Err(PathError::BadRequest("missing runtime file"));
        }
        return Ok(Target::Runtime(segments.join("/")));
    }
    let (id, version) = parse_id(head).ok_or(PathError::BadRequest("invalid artifact id"))?;
    let segments = normalize_segments(rest)?;
    Ok(Target::Artifact { id, version, segments })
}

/// Resolves normalized segments inside `base`, following directories to index.html and refusing
/// anything whose canonical path escapes `base`. Returns None when the file does not exist.
pub(crate) fn resolve_in(base: &Path, segments: &[String]) -> Option<PathBuf> {
    let base = base.canonicalize().ok()?;
    let mut candidate = base.clone();
    for s in segments {
        candidate.push(s);
    }
    let mut resolved = candidate.canonicalize().ok()?;
    if resolved.is_dir() {
        resolved = resolved.join("index.html").canonicalize().ok()?;
    }
    (resolved.starts_with(&base) && resolved.is_file()).then_some(resolved)
}

pub(crate) fn content_type_for(path: &str) -> String {
    let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        // mime_guess maps .ts to video/mp2t; artifact sources are text.
        "ts" | "tsx" | "jsx" | "mts" | "cts" => "text/plain".to_string(),
        "js" | "mjs" | "cjs" => "text/javascript".to_string(),
        "md" | "markdown" | "mdx" => "text/markdown".to_string(),
        "mmd" | "mermaid" => "text/plain".to_string(),
        "csv" => "text/csv".to_string(),
        "tsv" => "text/tab-separated-values".to_string(),
        "wasm" => "application/wasm".to_string(),
        _ => mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string(),
    };
    let textual = mime.starts_with("text/")
        || matches!(mime.as_str(), "application/json" | "application/xml" | "image/svg+xml" | "application/javascript");
    if textual { format!("{mime}; charset=utf-8") } else { mime }
}

fn paths() -> Option<&'static OpalPaths> {
    static PATHS: OnceLock<Option<OpalPaths>> = OnceLock::new();
    PATHS.get_or_init(|| OpalPaths::resolve().ok()).as_ref()
}

fn error_page(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let escaped = message.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let json = serde_json::to_string(message).unwrap_or_else(|_| "\"error\"".into()).replace("</", "<\\/");
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>{code}</title>\
<style>body{{font:14px -apple-system,system-ui,sans-serif;color:#5e5d59;display:grid;place-items:center;height:100vh;margin:0}}</style>\
<p>{code} · {escaped}</p>\
<script>try{{parent.postMessage({{type:\"opal:error\",message:{json},phase:\"load\"}},\"*\")}}catch(e){{}}</script>",
        code = status.as_u16()
    );
    base_response(status, "text/html; charset=utf-8").body(body.into_bytes()).unwrap()
}

fn base_response(status: StatusCode, content_type: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
}

/// Serves `bytes`, honoring a single `Range: bytes=a-b` (media elements in WebKit require it).
fn serve_bytes(req: &Request<Vec<u8>>, path_for_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let content_type = content_type_for(path_for_type);
    let total = bytes.len();
    if let Some(range) = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some((start, end)) = parse_range(range, total) {
            return base_response(StatusCode::PARTIAL_CONTENT, &content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .body(bytes[start..=end].to_vec())
                .unwrap();
        }
        return base_response(StatusCode::RANGE_NOT_SATISFIABLE, &content_type)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap();
    }
    let body = if req.method() == tauri::http::Method::HEAD { Vec::new() } else { bytes };
    base_response(StatusCode::OK, &content_type).header(header::ACCEPT_RANGES, "bytes").body(body).unwrap()
}

pub(crate) fn parse_range(value: &str, total: usize) -> Option<(usize, usize)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || total == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: usize = suffix.parse().ok()?;
            if n == 0 {
                return None;
            }
            (total.saturating_sub(n), total - 1)
        }
        (s, "") => (s.parse().ok()?, total - 1),
        (s, e) => (s.parse().ok()?, e.parse::<usize>().ok()?.min(total - 1)),
    };
    (start <= end && end < total).then_some((start, end))
}

fn runtime_file(rel: &str) -> Option<Vec<u8>> {
    // Debug builds read straight from the repo so shells can be iterated without a Rust rebuild.
    #[cfg(debug_assertions)]
    {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/artifact-runtime");
        let segments: Vec<String> = rel.split('/').map(str::to_string).collect();
        if let Some(p) = resolve_in(&dir, &segments) {
            if let Ok(bytes) = std::fs::read(p) {
                return Some(bytes);
            }
        }
    }
    RUNTIME_FILES.iter().find(|(name, _)| *name == rel).map(|(_, bytes)| bytes.to_vec())
}

/// Result of resolving an `artifact://` request path to bytes (shared by the protocol handler and the
/// smoke harness's `cmd_smoke_artifact_file`, so both use exactly the same path mapping).
pub(crate) enum Resolved {
    /// File bytes plus the path whose extension decides the content type.
    File { bytes: Vec<u8>, type_path: String },
    Error { status: StatusCode, message: String },
}

/// Maps the (still percent-encoded) URI path of an `artifact://` request to a file on disk.
pub(crate) fn resolve_request(raw_path: &str) -> Resolved {
    let fail = |status: StatusCode, message: String| Resolved::Error { status, message };
    let target = match parse_request_path(raw_path) {
        Ok(t) => t,
        Err(PathError::BadRequest(msg)) => return fail(StatusCode::BAD_REQUEST, msg.to_string()),
    };
    match target {
        Target::Runtime(rel) => match runtime_file(&rel) {
            Some(bytes) => Resolved::File { bytes, type_path: rel },
            None => fail(StatusCode::NOT_FOUND, format!("runtime file not found: {rel}")),
        },
        Target::Artifact { id, version, segments } => {
            let Some(paths) = paths() else {
                return fail(StatusCode::INTERNAL_SERVER_ERROR, "Opal directories unavailable".into());
            };
            let base = match version {
                None => paths.artifacts_dir.join(&id),
                Some(n) => match crate::versions::version_files_dir(&paths.artifact_versions_dir, &id, n) {
                    Some(dir) => dir,
                    None => return fail(StatusCode::NOT_FOUND, format!("version {n} of {id} not found")),
                },
            };
            let display = if segments.is_empty() { "index.html".to_string() } else { segments.join("/") };
            match resolve_in(&base, &segments) {
                Some(file) => match std::fs::read(&file) {
                    Ok(bytes) => Resolved::File { bytes, type_path: file.to_string_lossy().into_owned() },
                    Err(_) => fail(StatusCode::NOT_FOUND, format!("artifact file not readable: {display}")),
                },
                None => fail(StatusCode::NOT_FOUND, format!("artifact file not found: {display}")),
            }
        }
    }
}

pub fn handle<R: tauri::Runtime>(_ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let method = req.method();
    if method != tauri::http::Method::GET && method != tauri::http::Method::HEAD {
        return error_page(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    match resolve_request(req.uri().path()) {
        Resolved::File { bytes, type_path } => serve_bytes(&req, &type_path, bytes),
        Resolved::Error { status, message } => error_page(status, &message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn art(id: &str, version: Option<u32>, segs: &[&str]) -> Target {
        Target::Artifact { id: id.into(), version, segments: segs.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn parses_artifact_paths() {
        assert_eq!(parse_request_path("/art_01ABCxyz/index.html"), Ok(art("art_01ABCxyz", None, &["index.html"])));
        assert_eq!(parse_request_path("/art_a-b_c/src/App.tsx"), Ok(art("art_a-b_c", None, &["src", "App.tsx"])));
        assert_eq!(parse_request_path("/art_x/"), Ok(art("art_x", None, &[])));
        assert_eq!(parse_request_path("/art_x"), Ok(art("art_x", None, &[])));
        assert_eq!(parse_request_path("/art_x//./a//b.css"), Ok(art("art_x", None, &["a", "b.css"])));
        assert_eq!(parse_request_path("/art_x/my%20file.html"), Ok(art("art_x", None, &["my file.html"])));
        assert_eq!(parse_request_path("/art_x@12/app.js"), Ok(art("art_x", Some(12), &["app.js"])));
    }

    #[test]
    fn parses_runtime_paths() {
        assert_eq!(parse_request_path("/_runtime/react.html"), Ok(Target::Runtime("react.html".into())));
        assert_eq!(parse_request_path("/_runtime/vendor/marked.js"), Ok(Target::Runtime("vendor/marked.js".into())));
        assert!(parse_request_path("/_runtime/").is_err());
        assert!(parse_request_path("/_runtime/../secret").is_err());
    }

    #[test]
    fn rejects_bad_ids() {
        for p in ["/foo/index.html", "/art_/x", "/ART_x/x", "/art_x.staging-1/x", "/art_x@/x", "/art_x@1a/x", "/art_%2e%2e/x", "/../x", "/", ""] {
            assert!(parse_request_path(p).is_err(), "{p} should be rejected");
        }
    }

    #[test]
    fn rejects_traversal_and_bad_chars() {
        for p in [
            "/art_x/../art_y/index.html",
            "/art_x/a/../../b",
            "/art_x/%2e%2e/secret",
            "/art_x/%2E%2E%2Fsecret",
            "/art_x/a%00b",
            "/art_x/a%5Cb",
            "/art_x/C:/Windows",
            "/art_x/%ff%fe",
        ] {
            assert!(parse_request_path(p).is_err(), "{p} should be rejected");
        }
    }

    #[test]
    fn absolute_looking_paths_stay_relative() {
        // a leading slash inside the path cannot escape: segments are re-rooted at the artifact dir
        assert_eq!(parse_request_path("/art_x//etc/passwd"), Ok(art("art_x", None, &["etc", "passwd"])));
        assert_eq!(parse_request_path("/art_x/%2Fetc%2Fpasswd"), Ok(art("art_x", None, &["etc", "passwd"])));
    }

    #[test]
    fn resolves_files_dirs_and_blocks_symlink_escape() {
        let tmp = std::env::temp_dir().join(format!("opal-proto-test-{}", uuid::Uuid::new_v4()));
        let base = tmp.join("art_t");
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::write(base.join("index.html"), "root").unwrap();
        std::fs::write(base.join("sub/index.html"), "sub").unwrap();
        std::fs::write(tmp.join("secret.txt"), "secret").unwrap();
        let segs = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(std::fs::read_to_string(resolve_in(&base, &segs(&[])).unwrap()).unwrap(), "root");
        assert_eq!(std::fs::read_to_string(resolve_in(&base, &segs(&["sub"])).unwrap()).unwrap(), "sub");
        assert!(resolve_in(&base, &segs(&["missing.html"])).is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(tmp.join("secret.txt"), base.join("link.txt")).unwrap();
            assert!(resolve_in(&base, &segs(&["link.txt"])).is_none(), "symlink escape must be refused");
        }
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn content_types() {
        assert_eq!(content_type_for("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type_for("App.tsx"), "text/plain; charset=utf-8");
        assert_eq!(content_type_for("a.ts"), "text/plain; charset=utf-8");
        assert_eq!(content_type_for("app.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type_for("data.json"), "application/json; charset=utf-8");
        assert_eq!(content_type_for("logo.svg"), "image/svg+xml; charset=utf-8");
        assert_eq!(content_type_for("photo.PNG"), "image/png");
        assert_eq!(content_type_for("noext"), "application/octet-stream");
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-9", 100), Some((0, 9)));
        assert_eq!(parse_range("bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=50-500", 100), Some((50, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    #[test]
    fn runtime_files_are_complete() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/artifact-runtime");
        for entry in walkdir::WalkDir::new(&dir).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
            let rel = entry.path().strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
            if rel.ends_with(".md") || rel.starts_with('.') || rel.contains("/.") {
                continue;
            }
            assert!(RUNTIME_FILES.iter().any(|(n, _)| *n == rel), "{rel} is not embedded in RUNTIME_FILES");
        }
    }
}
