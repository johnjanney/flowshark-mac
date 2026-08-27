//! The FlowShark application shell.
//!
//! The Rust side stays deliberately small — the brief asks for the smallest
//! possible set of commands exposed to the front end (§13). It provides three
//! things the web layer cannot do safely on its own:
//!
//! 1. Reading and writing document files, with an atomic write so a failure
//!    part-way through never damages the file that is already on disk.
//! 2. Reporting a file's modification time, so the editor can notice when a
//!    sync service has changed a document underneath it.
//! 3. Opening additional document windows, and delivering the file the Finder
//!    asked the app to open.

mod files;
mod windows;

use std::sync::Mutex;

/// A file the Finder asked us to open before a window was ready to receive it.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Option<String>>);

/// Event name used to hand a file path to the front end.
pub const OPEN_FILE_EVENT: &str = "flowshark://open-file";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PendingOpen::default())
        .invoke_handler(tauri::generate_handler![
            files::read_text_file,
            files::save_text_atomic,
            files::save_binary_atomic,
            files::read_binary_file,
            files::file_modified_at,
            windows::open_new_window,
            windows::take_pending_open_file,
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("FlowShark failed to start")
        .run(|app_handle, event| {
            // macOS delivers a double-clicked document, an "Open With", or a
            // drop on the Dock icon as an Opened event.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                windows::handle_opened_urls(app_handle, urls);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle;
                let _ = &event;
            }
        });
}
