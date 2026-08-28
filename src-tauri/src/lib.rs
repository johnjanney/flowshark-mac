//! The FlowShark application shell.
//!
//! The Rust side stays deliberately small — the brief asks for the smallest
//! possible set of commands exposed to the front end (§13). It provides three
//! things the web layer cannot do safely on its own:
//!
//! 1. Reading and writing document files, with an atomic write so a failure
//!    part-way through never damages the file that is already on disk.
//! 2. Fingerprinting a file, so the editor can notice when a sync service or a
//!    restore has changed a document underneath it.
//! 3. Opening additional document windows, and delivering the file the Finder
//!    asked the app to open.
//!
//! It also presents the Open and Save panels, so that the web layer receives a
//! capability for the file the user chose rather than a pathname it could have
//! made up. See `grants.rs`.

mod files;
mod grants;
#[cfg(target_os = "macos")]
mod macos;
mod windows;

use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// A file the Finder asked us to open before a window was ready to receive it,
/// held as the grant that lets the web layer open it.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Option<grants::FileGrant>>);

/// Event name used to hand a file grant to the front end.
pub const OPEN_FILE_EVENT: &str = "flowshark://open-file";

/// Event name used to hand grants for dropped files to the front end.
pub const DROP_FILES_EVENT: &str = "flowshark://drop-files";

/// Files dropped on a window, with where they landed.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFiles {
    pub grants: Vec<grants::FileGrant>,
    pub position: (f64, f64),
}

fn is_document(path: &std::path::Path) -> bool {
    path.extension()
        .map(|extension| extension.eq_ignore_ascii_case("flowshark"))
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PendingOpen::default())
        .manage(grants::Grants::default())
        // Drops are handled here rather than in the web layer. The Tauri
        // drag-drop event hands the web view the dropped pathnames directly,
        // which would put the renderer back in the business of naming files;
        // issuing the grants on this side keeps that promise intact.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) =
                event
            {
                let app = window.app_handle();
                let store = app.state::<grants::Grants>();
                let issued: Vec<grants::FileGrant> = paths
                    .iter()
                    .filter(|path| path.is_file())
                    .map(|path| {
                        if is_document(path) {
                            // A dropped document is one the user may go on to
                            // save, so it is granted like one they opened.
                            store.issue_document(path.clone())
                        } else {
                            store.issue(path.clone(), true, false, grants::Lifetime::Once)
                        }
                    })
                    .collect();
                if issued.is_empty() {
                    return;
                }
                let scale = window.scale_factor().unwrap_or(1.0);
                let logical = position.to_logical::<f64>(scale);
                let _ = window.emit(
                    DROP_FILES_EVENT,
                    DroppedFiles {
                        grants: issued,
                        position: (logical.x, logical.y),
                    },
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::read_text_file,
            files::save_text_atomic,
            files::save_binary_atomic,
            files::read_binary_file,
            files::file_fingerprint,
            files::write_temp_file,
            files::pick_document,
            files::pick_image,
            files::pick_save_path,
            files::recent_documents,
            files::grant_recent_document,
            files::clear_recent_documents,
            files::revoke_grant,
            files::reveal_item,
            windows::open_new_window,
            windows::print_window,
            windows::take_pending_open_file,
            #[cfg(target_os = "macos")]
            macos::copy_diagram_to_pasteboard,
            #[cfg(target_os = "macos")]
            macos::share_files,
            #[cfg(target_os = "macos")]
            macos::begin_file_drag,
        ]);

    // State the macOS integrations need to keep alive across a command call.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .manage(macos::SharePicker::default())
            .manage(macos::DragState::default());
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("FlowShark failed to start");

    // The recent-documents list lives on this side, because a path from the
    // web layer is a claim rather than evidence the user chose it.
    if let Ok(directory) = app.path().app_data_dir() {
        app.state::<grants::Grants>()
            .load(directory.join("recent-documents.json"));
    }

    app.run(|app_handle, event| {
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
