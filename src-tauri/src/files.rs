//! Document file access.
//!
//! Every command here takes a grant token rather than a pathname. The panels
//! are presented from this side, so the web layer never gets to name a file:
//! it names a capability the user created by choosing something. See
//! `grants.rs` for why.
//!
//! Writes go to a temporary file in the same directory and are then renamed
//! over the target. A rename within one volume is atomic, so an interrupted or
//! failed save leaves the previous version of the document intact — the
//! reliability requirement in the brief (§13).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::grants::{Access, FileGrant, Grants, Lifetime};

/// Documents are plain JSON; anything much larger than this is not a diagram.
const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;

/// Imported images are embedded in the document, so keep them to a sane size.
const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

/// Writes are bounded too, so a runaway or hostile caller cannot fill the disk.
/// A document is JSON and an export is a single image or PDF; neither has any
/// business being larger than a file this application will open.
const MAX_WRITE_BYTES: usize = 256 * 1024 * 1024;

fn check_write_size(len: usize) -> Result<(), String> {
    if len > MAX_WRITE_BYTES {
        return Err(format!(
            "This would write {} MB, which is larger than FlowShark writes.",
            len / (1024 * 1024)
        ));
    }
    Ok(())
}

fn describe(error: &std::io::Error, path: &Path) -> String {
    format!("{} ({})", error, path.display())
}

/// A counter that keeps two temporary names apart within the same nanosecond.
static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Build the temporary path used for an atomic write.
///
/// The name carries a unique suffix rather than being derived from the target
/// alone. Two writes to one document can overlap — automatic saving runs on a
/// timer, the user can press Command-S at any moment, and a second window can
/// hold the same file — and a shared temporary path would have both writes
/// filling one file before one of them renamed the interleaved result over the
/// document.
fn temporary_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let sequence = TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let mut temporary = path.to_path_buf();
    temporary.set_file_name(format!(".{name}.{nanos}-{sequence}.flowshark-tmp"));
    temporary
}

fn write_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
    check_write_size(bytes.len())?;
    let target = Path::new(path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|error| describe(&error, parent))?;
        }
    }

    let temporary = temporary_path(target);

    // Every failure past this point has to take the temporary file with it.
    // Each attempt now gets its own name, so an early return would otherwise
    // leave a fresh orphan beside the document on every retry — a full disk,
    // which fails at `write_all`, would litter one per attempt.
    let result = fill_temporary(&temporary, bytes)
        .and_then(|()| fs::rename(&temporary, target).map_err(|error| describe(&error, target)));

    match result {
        Ok(()) => {
            sync_parent_directory(target);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

/// Write `bytes` into `temporary` and flush them to the device.
fn fill_temporary(temporary: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(temporary).map_err(|error| describe(&error, temporary))?;
    file.write_all(bytes)
        .map_err(|error| describe(&error, temporary))?;
    // Flush to the device before the rename, so a power loss cannot leave a
    // renamed but empty file behind.
    file.sync_all().map_err(|error| describe(&error, temporary))
}

/// Flush the directory entry the rename created.
///
/// `sync_all` on the temporary file makes its *contents* durable, but the
/// rename that publishes them is a directory operation, and on most filesystems
/// that is not durable until the directory itself is synced. Without this,
/// power loss immediately after a save could leave the previous version of the
/// document in place — recoverable, but not the guarantee this module claims.
/// Best effort: a filesystem that will not open a directory is not a reason to
/// fail a save that has otherwise succeeded.
#[cfg(unix)]
fn sync_parent_directory(target: &Path) {
    if let Some(parent) = target.parent() {
        let parent = if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        };
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_target: &Path) {}

#[tauri::command]
pub fn read_text_file(app: AppHandle, token: String) -> Result<String, String> {
    let target = app.state::<Grants>().resolve(&token, Access::Read)?;
    let target = target.as_path();
    let metadata = fs::metadata(target).map_err(|error| describe(&error, target))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(format!(
            "This file is {} MB, which is larger than FlowShark opens.",
            metadata.len() / (1024 * 1024)
        ));
    }
    fs::read_to_string(target).map_err(|error| describe(&error, target))
}

#[tauri::command]
pub fn save_text_atomic(app: AppHandle, token: String, contents: String) -> Result<(), String> {
    let target = app.state::<Grants>().resolve(&token, Access::Write)?;
    write_atomic(&target.to_string_lossy(), contents.as_bytes())
}

#[tauri::command]
pub fn save_binary_atomic(app: AppHandle, token: String, contents: Vec<u8>) -> Result<(), String> {
    let target = app.state::<Grants>().resolve(&token, Access::Write)?;
    write_atomic(&target.to_string_lossy(), &contents)
}

/// Read a file as raw bytes.
///
/// The bytes come back as a binary IPC response rather than a JSON array, so
/// importing a photograph does not turn a few megabytes into tens of megabytes
/// of JSON on the way across.
#[tauri::command]
pub fn read_binary_file(app: AppHandle, token: String) -> Result<tauri::ipc::Response, String> {
    let target = app.state::<Grants>().resolve(&token, Access::Read)?;
    let target = target.as_path();
    let metadata = fs::metadata(target).map_err(|error| describe(&error, target))?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "This file is {} MB, which is larger than FlowShark imports.",
            metadata.len() / (1024 * 1024)
        ));
    }
    let bytes = fs::read(target).map_err(|error| describe(&error, target))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Write bytes to a uniquely named file in the system temporary directory and
/// return its path.
///
/// Used by Share and by dragging a diagram out of the window: both hand a real
/// file to another application, and both need it on disk before they start.
#[tauri::command]
pub fn write_temp_file(
    app: AppHandle,
    name: String,
    contents: Vec<u8>,
) -> Result<FileGrant, String> {
    let path = write_temp_file_at(&name, &contents)?;
    // The file exists only to be handed to another application, so the grant
    // is read-only: sharing and dragging need to read it, nothing needs to
    // write it again.
    Ok(app
        .state::<Grants>()
        .issue(path, true, false, Lifetime::Session))
}

/// Write `contents` to a uniquely named file in the temporary directory.
fn write_temp_file_at(name: &str, contents: &[u8]) -> Result<PathBuf, String> {
    // Keep only the last path component, so a caller cannot escape the
    // temporary directory with a name like "../../.ssh/authorized_keys".
    let safe_name = Path::new(name)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty() && value != "." && value != "..")
        .unwrap_or_else(|| "FlowShark".to_string());

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let directory = std::env::temp_dir().join(format!("flowshark-{unique}"));
    fs::create_dir_all(&directory).map_err(|error| describe(&error, &directory))?;

    let path = directory.join(safe_name);
    write_atomic(&path.to_string_lossy(), contents)?;
    Ok(path)
}

/// An opaque string that changes whenever the file behind `path` changes.
///
/// A modification time on its own is not enough to notice that a document was
/// replaced underneath the editor. A sync service, a restore from backup, or a
/// conflict resolution can put down a file whose timestamp is equal to, or
/// older than, the one that was read — and a timestamp with one-second
/// resolution can hide a change entirely. Combining the length and the
/// filesystem's own identity for the file with a nanosecond timestamp catches
/// all three, and the caller only ever compares two of these for equality.
#[tauri::command]
pub fn file_fingerprint(app: AppHandle, token: String) -> Result<String, String> {
    let target = app.state::<Grants>().resolve(&token, Access::Read)?;
    fingerprint_of(&target)
}

fn fingerprint_of(target: &Path) -> Result<String, String> {
    let metadata = fs::metadata(target).map_err(|error| describe(&error, target))?;
    let nanos = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    Ok(format!(
        "{}:{}:{}",
        metadata.len(),
        nanos,
        file_identity(&metadata)
    ))
}

/// The filesystem's own identity for a file, so that deleting and recreating it
/// at the same length and timestamp still reads as a change.
#[cfg(unix)]
fn file_identity(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!("{}-{}", metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
fn file_identity(_metadata: &fs::Metadata) -> String {
    "0-0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_temporary_export_cannot_escape_the_temporary_directory() {
        let path = write_temp_file_at("../../escape.png", b"data").unwrap();
        let path = path.as_path();
        assert_eq!(path.file_name().unwrap(), "escape.png");
        assert!(path.starts_with(std::env::temp_dir()));
        assert_eq!(fs::read(path).unwrap(), b"data");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_temporary_export_keeps_its_name() {
        let path = write_temp_file_at("My Diagram.pdf", b"pdf").unwrap();
        let path = path.as_path();
        assert_eq!(path.file_name().unwrap(), "My Diagram.pdf");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn temporary_path_sits_beside_the_target() {
        let target = Path::new("/tmp/diagrams/Plan.flowshark");
        let temporary = temporary_path(target);
        assert_eq!(temporary.parent(), target.parent());
        assert_ne!(temporary.file_name(), target.file_name());
    }

    #[test]
    fn two_writes_never_share_a_temporary_path() {
        // Overlapping saves of one document must not fill the same temporary
        // file, or the rename publishes a mixture of both payloads.
        let target = Path::new("/tmp/diagrams/Plan.flowshark");
        assert_ne!(temporary_path(target), temporary_path(target));
    }

    #[test]
    fn a_failed_write_leaves_no_temporary_file_behind() {
        // Writing into a path whose parent is a file, not a directory, fails
        // at creation. Because each attempt has its own name, an attempt that
        // does not clean up leaves an orphan that the next one cannot reuse.
        let directory = std::env::temp_dir().join("flowshark-failed-write-test");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let blocker = directory.join("not-a-directory");
        fs::write(&blocker, b"x").unwrap();

        let path = blocker.join("doc.flowshark");
        let path_text = path.to_string_lossy().to_string();
        assert!(write_atomic(&path_text, b"payload").is_err());

        let leftovers = fs::read_dir(&directory)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".flowshark-tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_write_that_is_too_large_is_refused() {
        assert!(check_write_size(MAX_WRITE_BYTES).is_ok());
        assert!(check_write_size(MAX_WRITE_BYTES + 1).is_err());
    }

    #[test]
    fn a_fingerprint_changes_when_the_contents_change() {
        let directory = std::env::temp_dir().join("flowshark-fingerprint-test");
        let _ = fs::create_dir_all(&directory);
        let path = directory.join("doc.flowshark");
        let path_text = path.to_string_lossy().to_string();

        write_atomic(&path_text, b"first").unwrap();
        let first = fingerprint_of(&path).unwrap();
        assert_eq!(fingerprint_of(&path).unwrap(), first);

        // A different length is a different fingerprint even if the clock has
        // not moved and the timestamp is unchanged.
        write_atomic(&path_text, b"second payload").unwrap();
        assert_ne!(fingerprint_of(&path).unwrap(), first);

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn an_atomic_write_replaces_the_previous_contents() {
        let directory = std::env::temp_dir().join("flowshark-atomic-test");
        let _ = fs::create_dir_all(&directory);
        let path = directory.join("doc.flowshark");
        let path_text = path.to_string_lossy().to_string();

        write_atomic(&path_text, b"first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");

        write_atomic(&path_text, b"second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");

        // No temporary file is left behind. The name carries a unique suffix,
        // so this looks for any leftover rather than one predictable path.
        let leftovers = fs::read_dir(&directory)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".flowshark-tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn writing_into_a_missing_directory_creates_it() {
        let directory = std::env::temp_dir().join("flowshark-atomic-test-nested/inner");
        let _ = fs::remove_dir_all(directory.parent().unwrap());
        let path = directory.join("doc.flowshark");
        write_atomic(&path.to_string_lossy(), b"hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
        let _ = fs::remove_dir_all(directory.parent().unwrap());
    }
}

// ---------------------------------------------------------------------------
// Choosing files
// ---------------------------------------------------------------------------
//
// The panels are presented here rather than from the web layer. That is the
// whole point of the grant model: the pathname the user picks never has to be
// trusted coming back the other way, because it never goes that way.

const DOCUMENT_EXTENSION: &str = "flowshark";
const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

/// Present the Open panel for a document.
#[tauri::command]
pub fn pick_document(app: AppHandle) -> Option<FileGrant> {
    let chosen = app
        .dialog()
        .file()
        .add_filter("FlowShark Document", &[DOCUMENT_EXTENSION])
        .blocking_pick_file()?;
    let path = chosen.into_path().ok()?;
    Some(app.state::<Grants>().issue_document(path))
}

/// Present the Open panel for an image to place on the canvas.
#[tauri::command]
pub fn pick_image(app: AppHandle) -> Option<FileGrant> {
    let chosen = app
        .dialog()
        .file()
        .add_filter("Images", &IMAGE_EXTENSIONS)
        .blocking_pick_file()?;
    let path = chosen.into_path().ok()?;
    // Reading it once is all an import needs.
    Some(
        app.state::<Grants>()
            .issue(path, true, false, Lifetime::Once),
    )
}

/// Present the Save panel.
///
/// A document keeps its grant for the session, because it will be saved again
/// — by Command-S and by automatic saving. An export is written once.
#[tauri::command]
pub fn pick_save_path(
    app: AppHandle,
    suggested_name: String,
    extension: String,
) -> Option<FileGrant> {
    let label = if extension == DOCUMENT_EXTENSION {
        "FlowShark Document".to_string()
    } else {
        extension.to_uppercase()
    };
    let chosen = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter(&label, &[extension.as_str()])
        .blocking_save_file()?;
    let path = chosen.into_path().ok()?;
    let grants = app.state::<Grants>();
    if extension == DOCUMENT_EXTENSION {
        Some(grants.issue_document(path))
    } else {
        Some(grants.issue(path, false, true, Lifetime::Once))
    }
}

/// Documents the user has opened or saved before, newest first.
#[tauri::command]
pub fn recent_documents(app: AppHandle) -> Vec<String> {
    app.state::<Grants>().remembered()
}

/// A grant for a document from the recent-documents menu.
///
/// Refused unless this side already knows the user chose that path, so the
/// menu cannot be used to name a file they never picked.
#[tauri::command]
pub fn grant_recent_document(app: AppHandle, path: String) -> Option<FileGrant> {
    app.state::<Grants>().grant_remembered(&path)
}

#[tauri::command]
pub fn clear_recent_documents(app: AppHandle) {
    app.state::<Grants>().forget_remembered();
}

/// Withdraw a grant, when its document is closed or replaced.
#[tauri::command]
pub fn revoke_grant(app: AppHandle, token: String) {
    app.state::<Grants>().revoke(&token);
}

/// Show a file in the Finder.
#[tauri::command]
pub fn reveal_item(app: AppHandle, token: String) -> Result<(), String> {
    let target = app.state::<Grants>().resolve(&token, Access::Read)?;
    app.opener()
        .reveal_item_in_dir(&target)
        .map_err(|error| error.to_string())
}
