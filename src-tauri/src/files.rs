//! Document file access.
//!
//! Writes go to a temporary file in the same directory and are then renamed
//! over the target. A rename within one volume is atomic, so an interrupted or
//! failed save leaves the previous version of the document intact — the
//! reliability requirement in the brief (§13).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Documents are plain JSON; anything much larger than this is not a diagram.
const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;

/// Imported images are embedded in the document, so keep them to a sane size.
const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

fn describe(error: &std::io::Error, path: &Path) -> String {
    format!("{} ({})", error, path.display())
}

/// Build the temporary path used for an atomic write.
fn temporary_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    let mut temporary = path.to_path_buf();
    temporary.set_file_name(format!(".{name}.flowshark-tmp"));
    temporary
}

fn write_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = Path::new(path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|error| describe(&error, parent))?;
        }
    }

    let temporary = temporary_path(target);
    {
        let mut file =
            fs::File::create(&temporary).map_err(|error| describe(&error, &temporary))?;
        file.write_all(bytes)
            .map_err(|error| describe(&error, &temporary))?;
        // Flush to the device before the rename, so a power loss cannot leave
        // a renamed but empty file behind.
        file.sync_all()
            .map_err(|error| describe(&error, &temporary))?;
    }

    match fs::rename(&temporary, target) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(describe(&error, target))
        }
    }
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let target = Path::new(&path);
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
pub fn save_text_atomic(path: String, contents: String) -> Result<(), String> {
    write_atomic(&path, contents.as_bytes())
}

#[tauri::command]
pub fn save_binary_atomic(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_atomic(&path, &contents)
}

/// Read a file as raw bytes.
///
/// The bytes come back as a binary IPC response rather than a JSON array, so
/// importing a photograph does not turn a few megabytes into tens of megabytes
/// of JSON on the way across.
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    let target = Path::new(&path);
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

/// Modification time in milliseconds since the Unix epoch.
#[tauri::command]
pub fn file_modified_at(path: String) -> Result<u64, String> {
    let target = Path::new(&path);
    let metadata = fs::metadata(target).map_err(|error| describe(&error, target))?;
    let modified = metadata
        .modified()
        .map_err(|error| describe(&error, target))?;
    let since_epoch = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?;
    Ok(since_epoch.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_path_sits_beside_the_target() {
        let target = Path::new("/tmp/diagrams/Plan.flowshark");
        let temporary = temporary_path(target);
        assert_eq!(temporary.parent(), target.parent());
        assert_ne!(temporary.file_name(), target.file_name());
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

        // No temporary file is left behind.
        assert!(!temporary_path(&path).exists());
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
