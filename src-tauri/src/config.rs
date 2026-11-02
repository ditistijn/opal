//! Generated opencode.json + bundled prompts. Owner: runtime (prompts content: providers/settings).
use crate::paths::OpalPaths;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Writes pretty JSON via a temp file + rename so OpenCode's watcher never sees a partial file.
pub fn write_json_atomic(path: &Path, value: &serde_json::Value) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(())
}

/// Reads a JSON (or JSONC) file; Ok(None) when it does not exist.
pub fn read_json(path: &Path) -> anyhow::Result<Option<serde_json::Value>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(parse_jsonc(&text)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Parses JSON with comments and trailing commas (the format OpenCode accepts for its config).
pub fn parse_jsonc(text: &str) -> anyhow::Result<serde_json::Value> {
    Ok(serde_json::from_str(&strip_jsonc(text))?)
}

fn strip_jsonc(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let (mut i, mut in_string) = (0, false);
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                out.push(chars[i + 1]);
                i += 1;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match (c, chars.get(i + 1)) {
            ('"', _) => {
                in_string = true;
                out.push(c);
                i += 1;
            }
            ('/', Some('/')) => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            ('/', Some('*')) => {
                i += 2;
                while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
            }
            (',', _) => {
                // Drop trailing commas before } or ].
                let next = chars[i + 1..].iter().find(|c| !c.is_whitespace());
                if !matches!(next, Some('}') | Some(']')) {
                    out.push(c);
                }
                i += 1;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub async fn cmd_read_opencode_config() -> Result<serde_json::Value, String> {
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    Ok(read_json(&paths.opencode_config_file)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
pub async fn cmd_write_opencode_config(config: serde_json::Value) -> Result<(), String> {
    if !config.is_object() {
        return Err("opencode.json must be a JSON object".into());
    }
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    write_json_atomic(&paths.opencode_config_file, &config).map_err(|e| e.to_string())
}

/// Reads the user's own CLI config (~/.config/opencode/opencode.json) for the "Import" action.
#[tauri::command]
pub async fn cmd_read_user_cli_config() -> Result<Option<serde_json::Value>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(None);
    };
    let dir = home.join(".config").join("opencode");
    for name in ["opencode.json", "opencode.jsonc", "config.json"] {
        if let Some(value) = read_json(&dir.join(name)).map_err(|e| format!("{name}: {e}"))? {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

/// Reads a bundled prompt from resources/prompts/<mode>.md
#[tauri::command]
pub async fn cmd_read_prompt(app: tauri::AppHandle, mode: String) -> Result<String, String> {
    if !is_safe_name(&mode) {
        return Err("invalid mode".into());
    }
    let file = format!("{mode}.md");
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("prompts").join(&file));
    }
    // Dev fallback: the repo's resources folder.
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../resources/prompts")
            .join(&file),
    );
    candidates
        .iter()
        .find_map(|p| std::fs::read_to_string(p).ok())
        .ok_or_else(|| format!("prompt {file} not found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_comments_and_trailing_commas() {
        let v = parse_jsonc(
            r#"{
              // comment
              "a": "http://x//y", /* block */
              "b": [1, 2,],
            }"#,
        )
        .unwrap();
        assert_eq!(v, serde_json::json!({ "a": "http://x//y", "b": [1, 2] }));
    }

    #[test]
    fn atomic_write_roundtrip() {
        let dir = std::env::temp_dir().join(format!("opal-cfg-{}", uuid::Uuid::new_v4()));
        let file = dir.join("x").join("opencode.json");
        write_json_atomic(&file, &serde_json::json!({ "k": 1 })).unwrap();
        assert_eq!(
            read_json(&file).unwrap(),
            Some(serde_json::json!({ "k": 1 }))
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
