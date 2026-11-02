//! Conversation sandboxes ("cowork" dirs), uploads, project knowledge, file listing. Owner: runtime.
//!
//! A conversation sandbox is `<root>/conversations/<sessionID>/` (the TS side generates the
//! OpenCode session id before creating the session, so the folder can be named after it).
//! Destructive operations only ever act on paths inside the Opal root.
use crate::paths::OpalPaths;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri_plugin_dialog::DialogExt;

const MAX_LISTED_FILES: usize = 2000;
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".opencode",
    ".venv",
    "__pycache__",
    ".next",
    "target",
];
const SKIPPED_FILES: &[&str] = &[".DS_Store"];

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    /// Absolute path.
    pub path: String,
    /// Path relative to the listed directory (or the file name for imports), "/"-separated.
    pub name: String,
    pub size: u64,
    /// Modification time, epoch milliseconds.
    pub modified: i64,
}

fn paths() -> Result<OpalPaths, String> {
    OpalPaths::resolve().map_err(|e| e.to_string())
}

/// Folder keys (session / project ids) are single path segments of safe characters.
fn validate_key(key: &str) -> Result<&str, String> {
    let ok = !key.is_empty()
        && key.len() <= 128
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(key)
    } else {
        Err(format!("invalid id: {key:?}"))
    }
}

/// Reduces a user-supplied file name to a safe single segment.
fn sanitize_file_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

/// `name.ext`, `name (1).ext`, `name (2).ext`, … — the first that does not exist in `dir`.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("unbounded range")
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn entry_for(path: &Path, name: String) -> Result<FileEntry, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(FileEntry {
        path: path.to_string_lossy().into_owned(),
        name,
        size: meta.len(),
        modified: modified_ms(&meta),
    })
}

/// Lexically normalizes `path` (no symlink resolution) and requires it to stay inside `root`.
fn ensure_inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".into());
    }
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let resolved = std::fs::canonicalize(&out).unwrap_or(out);
    if resolved.starts_with(&root) && resolved != root {
        Ok(resolved)
    } else {
        Err(format!(
            "{} is outside the Opal data folder",
            path.display()
        ))
    }
}

/// Copies files (by absolute path) and inline bytes into `dest`, de-duplicating names.
fn import_into(
    dest: &Path,
    sources: &[String],
    inline: &[(String, Vec<u8>)],
) -> Result<Vec<FileEntry>, String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(sources.len() + inline.len());
    for src in sources {
        let src = Path::new(src);
        if !src.is_file() {
            return Err(format!("{} is not a file", src.display()));
        }
        let name = sanitize_file_name(&src.to_string_lossy());
        let target = unique_path(dest, &name);
        std::fs::copy(src, &target).map_err(|e| format!("copy {}: {e}", src.display()))?;
        let name = target
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        out.push(entry_for(&target, name)?);
    }
    for (name, bytes) in inline {
        let target = unique_path(dest, &sanitize_file_name(name));
        std::fs::write(&target, bytes).map_err(|e| format!("write {}: {e}", target.display()))?;
        let name = target
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        out.push(entry_for(&target, name)?);
    }
    Ok(out)
}

fn list_files(dir: &Path) -> Vec<FileEntry> {
    let walker = walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && e.depth() > 0 && SKIPPED_DIRS.contains(&name.as_ref()))
        });
    let mut files: Vec<FileEntry> = walker
        .filter_map(Result::ok)
        .filter(|e| {
            e.file_type().is_file()
                && !SKIPPED_FILES.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .take(MAX_LISTED_FILES)
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let rel = e
                .path()
                .strip_prefix(dir)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some(FileEntry {
                path: e.path().to_string_lossy().into_owned(),
                name: rel,
                size: meta.len(),
                modified: modified_ms(&meta),
            })
        })
        .collect();
    files.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.name.cmp(&b.name))
    });
    files
}

/// Creates `conversations/<sessionID>/uploads/` and returns the absolute conversation directory.
#[tauri::command]
pub async fn cmd_create_conversation_dir(session_id: String) -> Result<String, String> {
    let paths = paths()?;
    let dir = paths.conversations_dir.join(validate_key(&session_id)?);
    std::fs::create_dir_all(dir.join("uploads")).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Copies dropped files into `conversations/<sessionID>/uploads/` (or `knowledge/` with
/// `subdir: "knowledge"`, used for project knowledge). `inline` carries `[name, bytes]` pairs for
/// pasted / in-memory files. Returned names are relative to the conversation folder.
#[tauri::command]
pub async fn cmd_import_uploads(
    session_id: String,
    paths: Vec<String>,
    inline: Vec<(String, Vec<u8>)>,
    subdir: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let subdir = subdir.unwrap_or_else(|| "uploads".into());
    if subdir != "uploads" && subdir != "knowledge" {
        return Err(format!("invalid upload folder: {subdir}"));
    }
    let opal = self::paths()?;
    let dest = opal
        .conversations_dir
        .join(validate_key(&session_id)?)
        .join(&subdir);
    let mut entries = import_into(&dest, &paths, &inline)?;
    for e in &mut entries {
        e.name = format!("{subdir}/{}", e.name);
    }
    Ok(entries)
}

#[tauri::command]
pub async fn cmd_list_session_files(directory: String) -> Result<Vec<FileEntry>, String> {
    let dir = PathBuf::from(&directory);
    if !dir.is_absolute() {
        return Err("directory must be absolute".into());
    }
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || list_files(&dir))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// Opens a file with its default application.
#[tauri::command]
pub async fn cmd_open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("{path} does not exist"));
    }
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

/// Shows a save dialog pre-filled with the file's name and copies the file there.
#[tauri::command]
pub async fn cmd_save_file_as(
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<String>, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("{path} is not a file"));
    }
    let name = src
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut dialog = app.dialog().file().set_file_name(name);
    if let Some(downloads) = dirs::download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    let Some(target) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let target = target.into_path().map_err(|e| e.to_string())?;
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn cmd_pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a folder")
        .blocking_pick_folder();
    match picked {
        Some(p) => Ok(Some(
            p.into_path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned(),
        )),
        None => Ok(None),
    }
}

/// Copies knowledge files into `projects/<projectID>/knowledge/`.
/// `inline` (optional) carries `[name, bytes]` pairs for in-memory files.
#[tauri::command]
pub async fn cmd_import_project_knowledge(
    project_id: String,
    paths: Vec<String>,
    inline: Option<Vec<(String, Vec<u8>)>>,
) -> Result<Vec<FileEntry>, String> {
    let opal = self::paths()?;
    let dest = opal
        .projects_dir
        .join(validate_key(&project_id)?)
        .join("knowledge");
    import_into(&dest, &paths, &inline.unwrap_or_default())
}

#[tauri::command]
pub async fn cmd_delete_conversation_dir(session_id: String) -> Result<(), String> {
    let paths = paths()?;
    let dir = paths.conversations_dir.join(validate_key(&session_id)?);
    if !dir.exists() {
        return Ok(());
    }
    let dir = ensure_inside(&paths.conversations_dir, &dir)?;
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("opal-sbx-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn rejects_bad_keys() {
        assert!(validate_key("ses_abc-123").is_ok());
        for bad in ["", "..", "a/b", "a b", "../x"] {
            assert!(validate_key(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("/etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("../../x.csv"), "x.csv");
        assert_eq!(sanitize_file_name(".hidden"), "hidden");
        assert_eq!(sanitize_file_name(""), "file");
    }

    #[test]
    fn dedupes_and_lists() {
        let dir = tmp();
        let src = dir.join("data.csv");
        std::fs::write(&src, "a,b").unwrap();
        let dest = dir.join("uploads");
        let src_s = src.to_string_lossy().into_owned();
        let first = import_into(
            &dest,
            &[src_s.clone()],
            &[("data.csv".into(), b"x".to_vec())],
        )
        .unwrap();
        assert_eq!(
            first.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["data.csv", "data (1).csv"]
        );
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("node_modules/x/i.js"), "").unwrap();
        let names: Vec<String> = list_files(&dir).into_iter().map(|e| e.name).collect();
        assert!(names.contains(&"uploads/data.csv".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("node_modules")));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ensure_inside_blocks_escape() {
        let dir = tmp();
        std::fs::create_dir_all(dir.join("a")).unwrap();
        assert!(ensure_inside(&dir, &dir.join("a")).is_ok());
        assert!(ensure_inside(&dir, &dir.join("a/../..")).is_err());
        assert!(ensure_inside(&dir, &dir).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
