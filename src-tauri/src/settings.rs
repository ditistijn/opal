//! settings.json persistence (opaque JSON; schema lives in TypeScript). Owner: runtime.
use crate::config::{read_json, write_json_atomic};
use crate::paths::OpalPaths;

/// API keys live in OpenCode's credential store; never let one reach settings.json.
fn strip_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.remove("apiKey");
            map.values_mut().for_each(strip_secrets);
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(strip_secrets),
        _ => {}
    }
}

#[tauri::command]
pub async fn cmd_read_settings() -> Result<Option<serde_json::Value>, String> {
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    read_json(&paths.settings_file).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_write_settings(settings: serde_json::Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("settings must be a JSON object".into());
    }
    let mut settings = settings;
    strip_secrets(&mut settings);
    let paths = OpalPaths::resolve().map_err(|e| e.to_string())?;
    write_json_atomic(&paths.settings_file, &settings).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_nested_api_keys() {
        let mut v =
            serde_json::json!({ "providers": [{ "id": "a", "apiKey": "secret", "headers": {} }] });
        strip_secrets(&mut v);
        assert_eq!(
            v,
            serde_json::json!({ "providers": [{ "id": "a", "headers": {} }] })
        );
    }
}
