//! Opal — Tauri core.
//!
//! Modules (one owner each, see docs/ARCHITECTURE.md §6):
//!   paths            Opal + OpenCode XDG directories under ~/Library/Application Support/Opal
//!   sidecar          spawn / supervise the private `opencode serve` process
//!   sandbox_exec     macOS sandbox-exec wrapper shell for agent commands (docs/SECURITY.md)
//!   remote_web       LAN static server for the Opal web UI while remote control is on
//!   sandbox          per-conversation "cowork" directories, uploads, project knowledge, file listing
//!   config           read/write the generated opencode.json (providers, agents, experimental flags)
//!   settings         settings.json persistence
//!   artifact_protocol custom `artifact://` URI scheme serving artifact files from disk (isolated origin)
//!   versions         immutable artifact version snapshots
//!   menu             native macOS menu bar + window chrome
//!   smoke            in-app acceptance smoke harness support (OPAL_SMOKE, scripts/smoke-mac.sh)

mod artifact_protocol;
mod config;
mod menu;
mod net;
mod paths;
mod remote_web;
mod sandbox;
mod sandbox_exec;
mod settings;
mod sidecar;
mod smoke;
mod versions;

pub use paths::OpalPaths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Over-the-air updates from GitHub Releases (docs/UPDATES.md); driven by src/lib/native/updates.ts.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(sidecar::SidecarState::default())
        .manage(remote_web::RemoteState::default())
        .register_uri_scheme_protocol("artifact", artifact_protocol::handle)
        .setup(|app| {
            menu::setup(app)?;
            sandbox_exec::setup();
            sidecar::setup(app)?;
            remote_web::setup(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // paths
            paths::cmd_paths,
            // sidecar
            sidecar::cmd_server_connection,
            sidecar::cmd_server_restart,
            sidecar::cmd_server_logs,
            // sandbox
            sandbox::cmd_create_conversation_dir,
            sandbox::cmd_import_uploads,
            sandbox::cmd_list_session_files,
            sandbox::cmd_reveal_path,
            sandbox::cmd_open_path,
            sandbox::cmd_save_file_as,
            sandbox::cmd_pick_directory,
            sandbox::cmd_import_project_knowledge,
            sandbox::cmd_delete_conversation_dir,
            // sandbox_exec
            sandbox_exec::cmd_sandbox_status,
            sandbox_exec::cmd_sandbox_configure,
            // remote control
            remote_web::cmd_remote_status,
            remote_web::cmd_remote_configure,
            remote_web::cmd_remote_revoke,
            // config
            config::cmd_read_opencode_config,
            config::cmd_write_opencode_config,
            config::cmd_read_user_cli_config,
            // outbound HTTP without webview CORS (model discovery)
            net::cmd_http_get,
            config::cmd_read_prompt,
            // settings
            settings::cmd_read_settings,
            settings::cmd_write_settings,
            // versions
            versions::cmd_snapshot_artifact,
            versions::cmd_list_artifact_versions,
            versions::cmd_read_artifact_version,
            versions::cmd_save_artifact_export,
            versions::cmd_open_artifact_export,
            // smoke harness (inert unless OPAL_SMOKE is set)
            smoke::cmd_smoke_config,
            smoke::cmd_smoke_report,
            smoke::cmd_smoke_artifact_file,
            smoke::cmd_smoke_stat,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Opal")
        .run(|app, event| {
            // macOS Dock "reopen" → show the (hidden) main window again. See menu.rs.
            menu::on_run_event(app, &event);
        });
}
