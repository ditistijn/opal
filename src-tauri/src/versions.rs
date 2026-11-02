//! Artifact version snapshots under <artifact_versions_dir>/<artifactID>/<n>-<ts>/. Owner: artifacts.
//!
//! Layout of one snapshot:
//!   <artifact_versions_dir>/<artifactID>/<n>-<unix_ms>/meta.json   {"n","time","title"}
//!   <artifact_versions_dir>/<artifactID>/<n>-<unix_ms>/files/...   copy of <artifacts_dir>/<artifactID>/
//! Files live under `files/` so an artifact file called `meta.json` can never collide with the metadata.
//! Snapshots are served read-only at `artifact://localhost/<artifactID>@<n>/<path>` (artifact_protocol.rs).
//!
//! Also hosts the two export commands the artifact panel needs (save-as and open-in-browser), since
//! the fs plugin is not granted write access to arbitrary paths.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::artifact_protocol::is_valid_artifact_id;
use crate::paths::OpalPaths;

/// Maximum number of snapshots kept per artifact; older ones are pruned.
pub const MAX_VERSIONS: usize = 50;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ArtifactVersion {
    pub n: u32,
    pub time: i64,
    pub path: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Meta {
    n: u32,
    time: i64,
    title: String,
}

static LOCK: Mutex<()> = Mutex::new(());

fn check_id(id: &str) -> Result<(), String> {
    if is_valid_artifact_id(id) { Ok(()) } else { Err(format!("invalid artifact id: {id}")) }
}

/// Parses a snapshot directory name `<n>-<unix_ms>`.
fn parse_dir_name(name: &str) -> Option<(u32, i64)> {
    let (n, ts) = name.split_once('-')?;
    Some((n.parse().ok()?, ts.parse().ok()?))
}

/// All snapshot directories of an artifact, sorted by n ascending.
fn snapshot_dirs(artifact_versions: &Path) -> Vec<(u32, i64, PathBuf)> {
    let mut out: Vec<(u32, i64, PathBuf)> = std::fs::read_dir(artifact_versions)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let (n, ts) = parse_dir_name(&e.file_name().to_string_lossy())?;
            Some((n, ts, e.path()))
        })
        .collect();
    out.sort_by_key(|(n, _, _)| *n);
    out
}

/// `files/` directory of snapshot `n`, if it exists. Used by the artifact protocol.
pub(crate) fn version_files_dir(versions_root: &Path, artifact_id: &str, n: u32) -> Option<PathBuf> {
    if !is_valid_artifact_id(artifact_id) {
        return None;
    }
    snapshot_dirs(&versions_root.join(artifact_id))
        .into_iter()
        .find(|(vn, _, _)| *vn == n)
        .map(|(_, _, dir)| dir.join("files"))
        .filter(|d| d.is_dir())
}

/// Reads every regular file below `dir` into path → bytes (paths use `/`). Symlinks are skipped.
fn read_tree(dir: &Path) -> std::io::Result<BTreeMap<String, Vec<u8>>> {
    let mut out = BTreeMap::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in walkdir::WalkDir::new(dir).follow_links(false) {
        let entry = entry.map_err(std::io::Error::other)?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry.path().strip_prefix(dir).map_err(std::io::Error::other)?;
        let rel = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
        out.insert(rel, std::fs::read(entry.path())?);
    }
    Ok(out)
}

fn read_meta(dir: &Path, n: u32, ts: i64) -> ArtifactVersion {
    let meta: Option<Meta> =
        std::fs::read(dir.join("meta.json")).ok().and_then(|b| serde_json::from_slice(&b).ok());
    ArtifactVersion {
        n,
        time: meta.as_ref().map(|m| m.time).unwrap_or(ts),
        title: meta.map(|m| m.title).unwrap_or_default(),
        path: dir.to_string_lossy().into_owned(),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Snapshot `source` (an artifact directory) into `versions_root/<id>/`. Returns the previous version
/// unchanged when the files are byte-identical to it.
pub(crate) fn snapshot(source: &Path, versions_root: &Path, artifact_id: &str, title: &str) -> Result<ArtifactVersion, String> {
    check_id(artifact_id)?;
    let _guard = LOCK.lock().map_err(|_| "version lock poisoned".to_string())?;
    let current = read_tree(source).map_err(|e| format!("cannot read artifact: {e}"))?;
    if current.is_empty() {
        return Err(format!("artifact {artifact_id} has no files on disk"));
    }
    let root = versions_root.join(artifact_id);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let existing = snapshot_dirs(&root);
    if let Some((n, ts, dir)) = existing.last() {
        let previous = read_tree(&dir.join("files")).map_err(|e| e.to_string())?;
        if previous == current {
            let mut v = read_meta(dir, *n, *ts);
            // keep the newest title even when content did not change
            if !title.is_empty() && v.title != title {
                v.title = title.to_string();
                let meta = Meta { n: v.n, time: v.time, title: v.title.clone() };
                let _ = std::fs::write(dir.join("meta.json"), serde_json::to_vec_pretty(&meta).unwrap_or_default());
            }
            return Ok(v);
        }
    }
    let n = existing.last().map(|(n, _, _)| n + 1).unwrap_or(1);
    let time = now_ms();
    let final_dir = root.join(format!("{n}-{time}"));
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let write = || -> std::io::Result<()> {
        for (rel, bytes) in &current {
            let dest = staging.join("files").join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(dest, bytes)?;
        }
        let meta = Meta { n, time, title: title.to_string() };
        std::fs::write(staging.join("meta.json"), serde_json::to_vec_pretty(&meta)?)?;
        std::fs::rename(&staging, &final_dir)
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("cannot write snapshot: {e}"));
    }
    // prune oldest beyond MAX_VERSIONS
    let all = snapshot_dirs(&root);
    if all.len() > MAX_VERSIONS {
        for (_, _, dir) in &all[..all.len() - MAX_VERSIONS] {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(ArtifactVersion { n, time, title: title.to_string(), path: final_dir.to_string_lossy().into_owned() })
}

pub(crate) fn list(versions_root: &Path, artifact_id: &str) -> Result<Vec<ArtifactVersion>, String> {
    check_id(artifact_id)?;
    Ok(snapshot_dirs(&versions_root.join(artifact_id)).iter().map(|(n, ts, dir)| read_meta(dir, *n, *ts)).collect())
}

pub(crate) fn read_version(versions_root: &Path, artifact_id: &str, n: u32) -> Result<HashMap<String, String>, String> {
    check_id(artifact_id)?;
    let dir = version_files_dir(versions_root, artifact_id, n).ok_or_else(|| format!("version {n} of {artifact_id} not found"))?;
    let files = read_tree(&dir).map_err(|e| e.to_string())?;
    // OpenCode artifact files are UTF-8 strings (the tool API takes strings); skip anything else.
    Ok(files.into_iter().filter_map(|(k, v)| String::from_utf8(v).ok().map(|s| (k, s))).collect())
}

fn opal_paths() -> Result<OpalPaths, String> {
    OpalPaths::resolve().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_snapshot_artifact(artifact_id: String, title: String) -> Result<ArtifactVersion, String> {
    let paths = opal_paths()?;
    check_id(&artifact_id)?;
    tokio::task::spawn_blocking(move || {
        snapshot(&paths.artifacts_dir.join(&artifact_id), &paths.artifact_versions_dir, &artifact_id, &title)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cmd_list_artifact_versions(artifact_id: String) -> Result<Vec<ArtifactVersion>, String> {
    let paths = opal_paths()?;
    list(&paths.artifact_versions_dir, &artifact_id)
}

#[tauri::command]
pub async fn cmd_read_artifact_version(artifact_id: String, n: u32) -> Result<HashMap<String, String>, String> {
    let paths = opal_paths()?;
    read_version(&paths.artifact_versions_dir, &artifact_id, n)
}

// ---------- exports (artifact panel: Download / Open in browser) ----------

/// Keeps a suggested file name to a single safe path component.
pub(crate) fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')') { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() { "artifact".into() } else { trimmed.chars().take(120).collect() }
}

/// Shows a native save dialog (the user picks the destination) and writes `data` there.
/// Returns the written path, or None when the user cancelled.
#[tauri::command]
pub async fn cmd_save_artifact_export(
    app: tauri::AppHandle,
    file_name: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let name = sanitize_file_name(&file_name);
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_string());
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = ext.as_deref() {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    let Some(target) = tokio::task::spawn_blocking(move || dialog.blocking_save_file()).await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Writes a self-contained HTML export to the temp dir and opens it in the default browser.
#[tauri::command]
pub async fn cmd_open_artifact_export(artifact_id: String, html: String) -> Result<String, String> {
    check_id(&artifact_id)?;
    let dir = std::env::temp_dir().join("opal-artifacts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{artifact_id}.html"));
    std::fs::write(&path, html).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tmp() -> Tmp {
        let p = std::env::temp_dir().join(format!("opal-versions-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }

    #[test]
    fn snapshots_dedupe_list_read_and_serve() {
        let t = tmp();
        let src = t.0.join("artifacts/art_abc");
        let versions = t.0.join("versions");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("index.html"), "<h1>v1</h1>").unwrap();
        std::fs::write(src.join("meta.json"), "{\"mine\":true}").unwrap();
        std::fs::write(src.join("sub/app.js"), "console.log(1)").unwrap();

        let v1 = snapshot(&src, &versions, "art_abc", "First").unwrap();
        assert_eq!(v1.n, 1);
        let same = snapshot(&src, &versions, "art_abc", "Renamed").unwrap();
        assert_eq!(same.n, 1, "identical content must not create a version");
        assert_eq!(same.title, "Renamed");

        std::fs::write(src.join("index.html"), "<h1>v2</h1>").unwrap();
        let v2 = snapshot(&src, &versions, "art_abc", "Second").unwrap();
        assert_eq!(v2.n, 2);

        let listed = list(&versions, "art_abc").unwrap();
        assert_eq!(listed.iter().map(|v| v.n).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(listed[0].title, "Renamed");

        let files = read_version(&versions, "art_abc", 1).unwrap();
        assert_eq!(files.get("index.html").map(String::as_str), Some("<h1>v1</h1>"));
        assert_eq!(files.get("meta.json").map(String::as_str), Some("{\"mine\":true}"));
        assert_eq!(files.get("sub/app.js").map(String::as_str), Some("console.log(1)"));
        assert_eq!(files.len(), 3);

        assert!(version_files_dir(&versions, "art_abc", 2).unwrap().join("index.html").is_file());
        assert!(version_files_dir(&versions, "art_abc", 9).is_none());
        assert!(read_version(&versions, "art_abc", 9).is_err());
    }

    #[test]
    fn prunes_to_max_versions() {
        let t = tmp();
        let src = t.0.join("art_p");
        let versions = t.0.join("versions");
        std::fs::create_dir_all(&src).unwrap();
        for i in 0..(MAX_VERSIONS + 3) {
            std::fs::write(src.join("index.md"), format!("# {i}")).unwrap();
            snapshot(&src, &versions, "art_p", "t").unwrap();
        }
        let listed = list(&versions, "art_p").unwrap();
        assert_eq!(listed.len(), MAX_VERSIONS);
        assert_eq!(listed.first().unwrap().n, 4);
        assert_eq!(listed.last().unwrap().n as usize, MAX_VERSIONS + 3);
    }

    #[test]
    fn rejects_invalid_ids_and_empty_artifacts() {
        let t = tmp();
        assert!(snapshot(&t.0, &t.0, "../etc", "x").is_err());
        assert!(list(&t.0, "art_../x").is_err());
        assert!(read_version(&t.0, "nope", 1).is_err());
        assert!(snapshot(&t.0.join("art_missing"), &t.0.join("v"), "art_missing", "x").is_err());
        assert!(list(&t.0, "art_none").unwrap().is_empty());
    }

    #[test]
    fn sanitizes_export_names() {
        assert_eq!(sanitize_file_name("My Chart.html"), "My Chart.html");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(sanitize_file_name(""), "artifact");
        assert_eq!(sanitize_file_name("a/b\\c:d.zip"), "a-b-c-d.zip");
    }
}
