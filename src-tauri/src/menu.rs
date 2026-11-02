//! Native macOS menu bar and window chrome. Owner: macOS/packaging.
//!
//! The menu emits global Tauri events that the frontend listens to with
//! `listen()` from `@tauri-apps/api/event` (documented in docs/SETUP.md, "Menu events"):
//!
//! | Event                        | Payload            | Menu item                       |
//! | ---------------------------- | ------------------ | ------------------------------- |
//! | `menu:check-updates`         | `null`             | Opal › Check for Updates…       |
//! | `menu:settings`              | `null`             | Opal › Settings… (⌘,)           |
//! | `menu:new-chat`              | `null`             | File › New Chat (⌘N)            |
//! | `menu:new-project`           | `null`             | File › New Project (⌘⇧N)        |
//! | `menu:toggle-sidebar`        | `null`             | View › Toggle Sidebar (⌘⇧S)     |
//! | `menu:toggle-artifact-panel` | `null`             | View › Toggle Artifact Panel (⌘⇧A) |
//! | `menu:surface`               | `"chat"` / `"code"`| View › Chat (⌘1) / Code (⌘2)    |
//!
//! Every menu action first brings the main window back (it may be hidden after ⌘W on macOS),
//! then emits. Edit/Window items are Tauri predefined items so they act on the focused webview
//! (undo/redo/cut/copy/paste/select-all work in inputs and contenteditable).
//!
//! Window chrome (macOS): the title bar is a transparent overlay (`titleBarStyle: "Overlay"` in
//! tauri.conf.json, traffic lights inset to sit centred in the 38px `TitleBar`); the window
//! background follows the sidebar colour for the current appearance so resizes/launch never
//! flash white; closing the main window hides it, and clicking the Dock icon shows it again.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_opener::OpenerExt;

/// Label of the single app window (tauri.conf.json → app.windows[0].label).
pub const MAIN_WINDOW: &str = "main";

/// Where Help › Documentation / Report Issue point. Override at build time with
/// `OPAL_REPO_URL=https://github.com/<owner>/<repo> pnpm tauri build`.
const REPO_URL: &str = match option_env!("OPAL_REPO_URL") {
    Some(url) => url,
    None => "https://github.com/ditistijn/opal",
};

/// Menu item ids. The event name a frontend sees is derived in [`event_for`].
mod id {
    pub const CHECK_UPDATES: &str = "check-updates";
    pub const SETTINGS: &str = "settings";
    pub const NEW_CHAT: &str = "new-chat";
    pub const NEW_PROJECT: &str = "new-project";
    pub const TOGGLE_SIDEBAR: &str = "toggle-sidebar";
    pub const TOGGLE_ARTIFACT_PANEL: &str = "toggle-artifact-panel";
    pub const SURFACE_CHAT: &str = "surface-chat";
    pub const SURFACE_CODE: &str = "surface-code";
    pub const HELP_DOCS: &str = "help-docs";
    pub const HELP_ISSUE: &str = "help-issue";
    #[cfg(debug_assertions)]
    pub const DEV_RELOAD: &str = "dev-reload";
    #[cfg(debug_assertions)]
    pub const DEV_DEVTOOLS: &str = "dev-devtools";
}

/// What a menu id does: emit a frontend event (with optional string payload) or act natively.
#[derive(Debug, PartialEq, Eq)]
enum Action {
    Emit(&'static str, Option<&'static str>),
    OpenUrl(String),
    #[cfg(debug_assertions)]
    Reload,
    #[cfg(debug_assertions)]
    DevTools,
}

fn event_for(menu_id: &str) -> Option<Action> {
    Some(match menu_id {
        id::CHECK_UPDATES => Action::Emit("menu:check-updates", None),
        id::SETTINGS => Action::Emit("menu:settings", None),
        id::NEW_CHAT => Action::Emit("menu:new-chat", None),
        id::NEW_PROJECT => Action::Emit("menu:new-project", None),
        id::TOGGLE_SIDEBAR => Action::Emit("menu:toggle-sidebar", None),
        id::TOGGLE_ARTIFACT_PANEL => Action::Emit("menu:toggle-artifact-panel", None),
        id::SURFACE_CHAT => Action::Emit("menu:surface", Some("chat")),
        id::SURFACE_CODE => Action::Emit("menu:surface", Some("code")),
        id::HELP_DOCS => Action::OpenUrl(format!("{REPO_URL}/tree/main/docs")),
        id::HELP_ISSUE => Action::OpenUrl(format!("{REPO_URL}/issues/new")),
        #[cfg(debug_assertions)]
        id::DEV_RELOAD => Action::Reload,
        #[cfg(debug_assertions)]
        id::DEV_DEVTOOLS => Action::DevTools,
        _ => return None,
    })
}

pub fn setup(app: &mut tauri::App) -> anyhow::Result<()> {
    let handle = app.handle();
    let menu = build_menu(handle)?;
    app.set_menu(menu)?;
    app.on_menu_event(handle_menu_event);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        setup_window_chrome(&window);
    }
    Ok(())
}

/// Called from the app's run loop (lib.rs) for every [`RunEvent`].
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    // macOS: clicking the Dock icon when no window is visible shows the main window again.
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen {
        has_visible_windows,
        ..
    } = event
    {
        if !has_visible_windows {
            show_main_window(app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    let about = AboutMetadataBuilder::new()
        .name(Some("Opal"))
        .version(Some(pkg.version.to_string()))
        .copyright(Some("© 2026 ditistijn"))
        .comments(Some(
            "AI chat, Projects and Artifacts with any model. Powered by OpenCode.",
        ))
        .website(Some(REPO_URL))
        .website_label(Some("Opal on GitHub"))
        .build();

    let item = |id: &str, text: &str, accel: &str| {
        MenuItemBuilder::with_id(id, text)
            .accelerator(accel)
            .build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Opal")
        .about_with_text("About Opal", Some(about))
        .text(id::CHECK_UPDATES, "Check for Updates…")
        .separator()
        .item(&item(id::SETTINGS, "Settings…", "CmdOrCtrl+,")?)
        .separator()
        .services()
        .separator()
        .hide_with_text("Hide Opal")
        .hide_others()
        .show_all()
        .separator()
        .quit_with_text("Quit Opal")
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item(id::NEW_CHAT, "New Chat", "CmdOrCtrl+N")?)
        .item(&item(id::NEW_PROJECT, "New Project", "CmdOrCtrl+Shift+N")?)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_builder = SubmenuBuilder::new(app, "View")
        .item(&item(
            id::TOGGLE_SIDEBAR,
            "Toggle Sidebar",
            "CmdOrCtrl+Shift+S",
        )?)
        .item(&item(
            id::TOGGLE_ARTIFACT_PANEL,
            "Toggle Artifact Panel",
            "CmdOrCtrl+Shift+A",
        )?)
        .separator()
        .item(&item(id::SURFACE_CHAT, "Chat", "CmdOrCtrl+1")?)
        .item(&item(id::SURFACE_CODE, "Code", "CmdOrCtrl+2")?)
        .separator()
        .fullscreen_with_text("Enter Full Screen");
    #[cfg(debug_assertions)]
    let view_builder = view_builder
        .separator()
        .item(&item(id::DEV_RELOAD, "Reload", "CmdOrCtrl+R")?)
        .item(&item(
            id::DEV_DEVTOOLS,
            "Toggle Developer Tools",
            "CmdOrCtrl+Alt+I",
        )?);
    let view_menu = view_builder.build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize_with_text("Zoom")
        .separator()
        .bring_all_to_front()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text(id::HELP_DOCS, "Opal Documentation")
        .text(id::HELP_ISSUE, "Report an Issue…")
        .build()?;

    #[cfg(target_os = "macos")]
    {
        // Let AppKit manage the window list and the Help search field.
        window_menu.set_as_windows_menu_for_nsapp()?;
        help_menu.set_as_help_menu_for_nsapp()?;
    }

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let Some(action) = event_for(event.id().as_ref()) else {
        return;
    };
    match action {
        Action::Emit(name, payload) => {
            show_main_window(app);
            if let Err(err) = app.emit(name, payload) {
                log::warn!("failed to emit {name}: {err}");
            }
        }
        Action::OpenUrl(url) => {
            if let Err(err) = app.opener().open_url(&url, None::<&str>) {
                log::warn!("failed to open {url}: {err}");
            }
        }
        #[cfg(debug_assertions)]
        Action::Reload => {
            if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
                let _ = w.eval("window.location.reload()");
            }
        }
        #[cfg(debug_assertions)]
        Action::DevTools => {
            if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
                if w.is_devtools_open() {
                    w.close_devtools();
                } else {
                    w.open_devtools();
                }
            }
        }
    }
}

/// Show, unminimise and focus the main window (it is hidden, not destroyed, by ⌘W on macOS).
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn setup_window_chrome<R: Runtime>(window: &WebviewWindow<R>) {
    apply_background(window, window.theme().unwrap_or(tauri::Theme::Light));

    let w = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::ThemeChanged(theme) => apply_background(&w, *theme),
        // macOS convention: closing the last window keeps the app (and the sidecar) running;
        // the Dock icon / any menu action brings the window back.
        #[cfg(target_os = "macos")]
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = w.hide();
        }
        _ => {}
    });

    #[cfg(target_os = "macos")]
    macos::tweak_ns_window(window);
}

/// Sidebar colours from src/index.css (`--bg-sidebar`, light and dark). The window background
/// shows during launch, live resize and overscroll, so it must match the title bar / sidebar.
const SIDEBAR_LIGHT: tauri::window::Color = tauri::window::Color(0xf0, 0xee, 0xe6, 0xff);
const SIDEBAR_DARK: tauri::window::Color = tauri::window::Color(0x1f, 0x1e, 0x1d, 0xff);

fn sidebar_color(theme: tauri::Theme) -> tauri::window::Color {
    match theme {
        tauri::Theme::Dark => SIDEBAR_DARK,
        _ => SIDEBAR_LIGHT,
    }
}

fn apply_background<R: Runtime>(window: &WebviewWindow<R>, theme: tauri::Theme) {
    if let Err(err) = window.set_background_color(Some(sidebar_color(theme))) {
        log::debug!("set_background_color failed: {err}");
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::{NSWindow, NSWindowTitleVisibility};
    use tauri::{Runtime, WebviewWindow};

    /// Belt-and-braces over `titleBarStyle: "Overlay"`: make sure the title bar is transparent,
    /// the title hidden, and the window draggable only via the explicit drag region (so text
    /// selection in the content area never drags the window).
    pub fn tweak_ns_window<R: Runtime>(window: &WebviewWindow<R>) {
        let Ok(ptr) = window.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        let w = window.clone();
        let ptr = ptr as usize;
        let _ = w.run_on_main_thread(move || {
            // SAFETY: `ns_window()` returns the live NSWindow* owned by tao for this window; we
            // only touch it on the main thread, while the window exists.
            let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            ns_window.setTitlebarAppearsTransparent(true);
            ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
            ns_window.setMovableByWindowBackground(false);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_map_to_documented_events() {
        assert_eq!(
            event_for(id::CHECK_UPDATES),
            Some(Action::Emit("menu:check-updates", None))
        );
        assert_eq!(
            event_for(id::SETTINGS),
            Some(Action::Emit("menu:settings", None))
        );
        assert_eq!(
            event_for(id::NEW_CHAT),
            Some(Action::Emit("menu:new-chat", None))
        );
        assert_eq!(
            event_for(id::NEW_PROJECT),
            Some(Action::Emit("menu:new-project", None))
        );
        assert_eq!(
            event_for(id::TOGGLE_SIDEBAR),
            Some(Action::Emit("menu:toggle-sidebar", None))
        );
        assert_eq!(
            event_for(id::TOGGLE_ARTIFACT_PANEL),
            Some(Action::Emit("menu:toggle-artifact-panel", None))
        );
        assert_eq!(
            event_for(id::SURFACE_CHAT),
            Some(Action::Emit("menu:surface", Some("chat")))
        );
        assert_eq!(
            event_for(id::SURFACE_CODE),
            Some(Action::Emit("menu:surface", Some("code")))
        );
        assert!(
            matches!(event_for(id::HELP_DOCS), Some(Action::OpenUrl(u)) if u.ends_with("/docs"))
        );
        assert_eq!(event_for("unknown"), None);
    }
}
