//! Opal directory layout. See docs/ARCHITECTURE.md §2 "Directories".
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct OpalPaths {
    /// ~/Library/Application Support/Opal
    pub root: PathBuf,
    pub settings_file: PathBuf,
    /// XDG roots handed to the sidecar: root/opencode/{data,config,cache,state}
    pub xdg_data: PathBuf,
    pub xdg_config: PathBuf,
    pub xdg_cache: PathBuf,
    pub xdg_state: PathBuf,
    /// root/opencode/config/opencode/opencode.json
    pub opencode_config_file: PathBuf,
    /// root/opencode/data/opencode/artifacts
    pub artifacts_dir: PathBuf,
    pub conversations_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub artifact_versions_dir: PathBuf,
    pub logs_dir: PathBuf,
}

impl OpalPaths {
    pub fn resolve() -> anyhow::Result<Self> {
        let root = match std::env::var_os("OPAL_HOME") {
            Some(v) => PathBuf::from(v),
            None => dirs::data_dir()
                .ok_or_else(|| anyhow::anyhow!("no application support directory"))?
                .join("Opal"),
        };
        let oc = root.join("opencode");
        let xdg_data = oc.join("data");
        let xdg_config = oc.join("config");
        let paths = Self {
            settings_file: root.join("settings.json"),
            opencode_config_file: xdg_config.join("opencode").join("opencode.json"),
            artifacts_dir: xdg_data.join("opencode").join("artifacts"),
            conversations_dir: root.join("conversations"),
            projects_dir: root.join("projects"),
            artifact_versions_dir: root.join("artifact-versions"),
            logs_dir: root.join("logs"),
            xdg_cache: oc.join("cache"),
            xdg_state: oc.join("state"),
            xdg_data,
            xdg_config,
            root,
        };
        for d in [
            &paths.root,
            &paths.xdg_data,
            &paths.xdg_config,
            &paths.xdg_cache,
            &paths.xdg_state,
            &paths.conversations_dir,
            &paths.projects_dir,
            &paths.artifact_versions_dir,
            &paths.logs_dir,
        ] {
            std::fs::create_dir_all(d)?;
        }
        Ok(paths)
    }
}

#[tauri::command]
pub fn cmd_paths() -> Result<OpalPaths, String> {
    OpalPaths::resolve().map_err(|e| e.to_string())
}
