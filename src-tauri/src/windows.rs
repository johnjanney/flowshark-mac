//! Window management and Finder integration.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Url};

use crate::PendingOpen;
#[cfg(target_os = "macos")]
use crate::OPEN_FILE_EVENT;

/// Sequence used to give each new window a distinct label.
fn next_label(app: &AppHandle) -> String {
    let mut index = 1;
    while app.get_webview_window(&format!("main-{index}")).is_some() {
        index += 1;
    }
    format!("main-{index}")
}

/// Open another document window. macOS groups these into native window tabs
/// when the user has "Prefer tabs" switched on in System Settings.
#[tauri::command]
pub fn open_new_window(app: AppHandle) -> Result<(), String> {
    let label = next_label(&app);
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("FlowShark")
        .inner_size(1280.0, 840.0)
        .min_inner_size(880.0, 560.0);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

/// Open the system Print panel for this window.
///
/// `window.print()` in JavaScript is not reliable in WKWebView — the panel is
/// the host application's job to present — so printing goes through the
/// webview's own print method instead. The page's print stylesheet still
/// decides what appears on the paper.
#[tauri::command]
pub fn print_window(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

/// Hand the front end the file the app was launched with, if any.
#[tauri::command]
pub fn take_pending_open_file(app: AppHandle) -> Option<String> {
    let state = app.state::<PendingOpen>();
    let mut pending = state.0.lock().ok()?;
    pending.take()
}

/// Deliver documents the Finder asked us to open.
///
/// If a window is already listening the path is emitted straight away;
/// otherwise it is held until the front end asks for it during start-up.
#[cfg(target_os = "macos")]
pub fn handle_opened_urls(app: &AppHandle, urls: &[Url]) {
    for url in urls {
        let path = if url.scheme() == "file" {
            match url.to_file_path() {
                Ok(path) => path.to_string_lossy().to_string(),
                Err(()) => continue,
            }
        } else {
            continue;
        };

        if app.webview_windows().is_empty() {
            if let Ok(mut pending) = app.state::<PendingOpen>().0.lock() {
                *pending = Some(path);
            }
            continue;
        }
        let _ = app.emit(OPEN_FILE_EVENT, path);
    }
}
