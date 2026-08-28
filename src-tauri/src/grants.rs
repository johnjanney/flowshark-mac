//! Capability grants for file access.
//!
//! The web layer used to name the files it wanted: it called the Open panel
//! itself, received a pathname, and handed that pathname back to a command
//! that read or wrote it. Nothing checked where the pathname came from, so any
//! code running in the web view could read or write anywhere the user could —
//! and FlowShark is deliberately not sandboxed, so that is everywhere.
//!
//! Now the panels are presented from here, and what crosses the boundary is a
//! grant: an opaque token naming a file the *user* chose, with the access they
//! chose it for. A token cannot be turned into a different path, and a path
//! the user never picked has no token, so the web layer can no longer ask for
//! one. The pathname still travels back for display — the window title, the
//! recent-documents menu — but showing a path the user just chose grants no
//! capability, and every read and write goes through the token.
//!
//! Three things create a grant, and all three are the user acting:
//!
//! 1. Choosing a file in an Open or Save panel.
//! 2. Opening a document from the Finder, or dropping one on the window.
//! 3. Re-opening something from the recent-documents menu — which is why the
//!    set of paths the user has chosen is remembered here rather than in the
//!    web layer, where it would just be another pathname the renderer could
//!    make up.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

/// Live grants are capped so a caller cannot grow the table without bound.
/// Well past the number of documents and exports a session realistically has.
const MAX_LIVE_GRANTS: usize = 256;

/// How many recently chosen documents stay re-openable. Matches the length of
/// the menu the web layer draws.
const MAX_REMEMBERED: usize = 24;

/// What a grant permits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    Read,
    Write,
}

/// How long a grant survives.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lifetime {
    /// Withdrawn as soon as it is used. Imports and exports touch their file
    /// once, so their grant should not outlive the operation.
    Once,
    /// Lives until it is revoked or the process ends. A document is saved
    /// repeatedly — by Command-S, by automatic saving, and by the fingerprint
    /// check that runs before each write — so a grant for the open document
    /// cannot expire while the window is still showing it. Closing the
    /// document revokes it.
    Session,
}

struct Grant {
    path: PathBuf,
    read: bool,
    write: bool,
    lifetime: Lifetime,
    /// Issue order, used to evict the oldest when the table is full.
    issued: u64,
}

/// A grant as the web layer sees it: a token to act with, and a path to show.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileGrant {
    pub token: String,
    pub path: String,
}

#[derive(Default)]
pub struct Grants {
    live: Mutex<HashMap<String, Grant>>,
    /// Documents the user has chosen, newest first, so the recent-documents
    /// menu still works after a restart.
    remembered: Mutex<Vec<PathBuf>>,
    /// Where `remembered` is persisted, set once during start-up.
    store: Mutex<Option<PathBuf>>,
    sequence: AtomicU64,
}

fn token() -> String {
    // The only caller is this application's own web view, which already holds
    // the tokens it was given. Unguessable tokens matter for what it was *not*
    // given: another window's open document. The OS generator costs nothing
    // here, so there is no reason to use anything weaker.
    let mut bytes = [0u8; 16];
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        if file.read_exact(&mut bytes).is_ok() {
            return bytes.iter().map(|b| format!("{b:02x}")).collect();
        }
    }
    // A system that cannot provide randomness should not silently fall back to
    // something predictable, so this is deliberately not a counter: it fails
    // closed and the caller reports that the file could not be opened.
    String::new()
}

impl Grants {
    /// Point the remembered-documents list at a file and load what is there.
    pub fn load(&self, store: PathBuf) {
        if let Ok(text) = fs::read_to_string(&store) {
            if let Ok(paths) = serde_json::from_str::<Vec<String>>(&text) {
                let mut remembered = self.remembered.lock().unwrap();
                *remembered = paths.into_iter().map(PathBuf::from).collect();
                remembered.truncate(MAX_REMEMBERED);
            }
        }
        *self.store.lock().unwrap() = Some(store);
    }

    fn persist(&self) {
        let store = self.store.lock().unwrap().clone();
        let Some(store) = store else { return };
        let remembered = self.remembered.lock().unwrap();
        let paths: Vec<String> = remembered
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        drop(remembered);
        if let Some(parent) = store.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string(&paths) {
            // Losing this list costs the user a menu, not their work, so a
            // failure here must not fail the operation that triggered it.
            let _ = fs::write(&store, text);
        }
    }

    /// Issue a grant for `path`.
    pub fn issue(&self, path: PathBuf, read: bool, write: bool, lifetime: Lifetime) -> FileGrant {
        let token = token();
        let display = path.to_string_lossy().to_string();
        if token.is_empty() {
            return FileGrant {
                token: String::new(),
                path: display,
            };
        }
        let issued = self.sequence.fetch_add(1, Ordering::Relaxed);
        let mut live = self.live.lock().unwrap();
        if live.len() >= MAX_LIVE_GRANTS {
            // Evict the oldest rather than refusing: the newest grant is the
            // one the user just asked for.
            if let Some(oldest) = live
                .iter()
                .min_by_key(|(_, grant)| grant.issued)
                .map(|(key, _)| key.clone())
            {
                live.remove(&oldest);
            }
        }
        live.insert(
            token.clone(),
            Grant {
                path,
                read,
                write,
                lifetime,
                issued,
            },
        );
        FileGrant {
            token,
            path: display,
        }
    }

    /// Issue a grant for a document and remember that the user chose it.
    pub fn issue_document(&self, path: PathBuf) -> FileGrant {
        self.remember(&path);
        self.issue(path, true, true, Lifetime::Session)
    }

    fn remember(&self, path: &Path) {
        let mut remembered = self.remembered.lock().unwrap();
        remembered.retain(|entry| entry != path);
        remembered.insert(0, path.to_path_buf());
        remembered.truncate(MAX_REMEMBERED);
        drop(remembered);
        self.persist();
    }

    /// The path behind `token`, if it permits `need`.
    ///
    /// A `Once` grant is withdrawn here, so a token cannot be replayed.
    pub fn resolve(&self, token: &str, need: Access) -> Result<PathBuf, String> {
        let mut live = self.live.lock().unwrap();
        let Some(grant) = live.get(token) else {
            return Err(
                "FlowShark no longer has permission to use that file. Open or save it again."
                    .to_string(),
            );
        };
        let permitted = match need {
            Access::Read => grant.read,
            Access::Write => grant.write,
        };
        if !permitted {
            return Err(
                "FlowShark was not given permission to do that with this file.".to_string(),
            );
        }
        let path = grant.path.clone();
        if grant.lifetime == Lifetime::Once {
            live.remove(token);
        }
        Ok(path)
    }

    /// Withdraw a grant, when the document it belongs to is closed or replaced.
    pub fn revoke(&self, token: &str) {
        self.live.lock().unwrap().remove(token);
    }

    /// Documents the user has chosen before, newest first.
    pub fn remembered(&self) -> Vec<String> {
        self.remembered
            .lock()
            .unwrap()
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect()
    }

    /// A grant for a path from the recent-documents menu.
    ///
    /// The path arrives from the web layer, so it is only honoured when this
    /// side already knows the user chose it. Anything else is refused, which
    /// is what stops the menu from becoming a way to name an arbitrary file.
    pub fn grant_remembered(&self, path: &str) -> Option<FileGrant> {
        let wanted = PathBuf::from(path);
        let known = self
            .remembered
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == &wanted);
        if !known {
            return None;
        }
        Some(self.issue_document(wanted))
    }

    /// Forget every remembered document, for "Clear Menu".
    pub fn forget_remembered(&self) {
        self.remembered.lock().unwrap().clear();
        self.persist();
    }

    #[cfg(test)]
    fn live_count(&self) -> usize {
        self.live.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants() -> Grants {
        Grants::default()
    }

    #[test]
    fn a_token_resolves_only_to_the_path_it_was_issued_for() {
        let grants = grants();
        let a = grants.issue(
            PathBuf::from("/tmp/a.flowshark"),
            true,
            true,
            Lifetime::Session,
        );
        let b = grants.issue(
            PathBuf::from("/tmp/b.flowshark"),
            true,
            true,
            Lifetime::Session,
        );
        assert_ne!(a.token, b.token);
        assert_eq!(
            grants.resolve(&a.token, Access::Read).unwrap(),
            PathBuf::from("/tmp/a.flowshark")
        );
        assert_eq!(
            grants.resolve(&b.token, Access::Read).unwrap(),
            PathBuf::from("/tmp/b.flowshark")
        );
    }

    #[test]
    fn an_unknown_token_is_refused() {
        let grants = grants();
        assert!(grants.resolve("not-a-token", Access::Read).is_err());
        assert!(grants.resolve("", Access::Read).is_err());
    }

    #[test]
    fn a_read_grant_does_not_permit_writing() {
        let grants = grants();
        let grant = grants.issue(
            PathBuf::from("/tmp/picture.png"),
            true,
            false,
            Lifetime::Session,
        );
        assert!(grants.resolve(&grant.token, Access::Read).is_ok());
        assert!(grants.resolve(&grant.token, Access::Write).is_err());
    }

    #[test]
    fn a_write_grant_does_not_permit_reading() {
        let grants = grants();
        let grant = grants.issue(
            PathBuf::from("/tmp/export.png"),
            false,
            true,
            Lifetime::Once,
        );
        assert!(grants.resolve(&grant.token, Access::Read).is_err());
    }

    #[test]
    fn a_single_use_grant_cannot_be_replayed() {
        let grants = grants();
        let grant = grants.issue(
            PathBuf::from("/tmp/export.png"),
            false,
            true,
            Lifetime::Once,
        );
        assert!(grants.resolve(&grant.token, Access::Write).is_ok());
        assert!(grants.resolve(&grant.token, Access::Write).is_err());
    }

    #[test]
    fn a_session_grant_survives_repeated_saves() {
        // A document is written by Command-S, by automatic saving, and by the
        // fingerprint check before each write, so its grant has to last.
        let grants = grants();
        let grant = grants.issue(
            PathBuf::from("/tmp/doc.flowshark"),
            true,
            true,
            Lifetime::Session,
        );
        for _ in 0..10 {
            assert!(grants.resolve(&grant.token, Access::Write).is_ok());
            assert!(grants.resolve(&grant.token, Access::Read).is_ok());
        }
    }

    #[test]
    fn a_revoked_grant_stops_working() {
        let grants = grants();
        let grant = grants.issue(
            PathBuf::from("/tmp/doc.flowshark"),
            true,
            true,
            Lifetime::Session,
        );
        grants.revoke(&grant.token);
        assert!(grants.resolve(&grant.token, Access::Read).is_err());
    }

    #[test]
    fn the_recent_menu_cannot_name_a_path_the_user_never_chose() {
        let grants = grants();
        grants.issue_document(PathBuf::from("/tmp/chosen.flowshark"));
        assert!(grants.grant_remembered("/tmp/chosen.flowshark").is_some());
        assert!(grants.grant_remembered("/etc/passwd").is_none());
        assert!(grants
            .grant_remembered("/tmp/chosen.flowshark/../../etc/passwd")
            .is_none());
    }

    #[test]
    fn remembering_a_document_moves_it_to_the_front_without_duplicating() {
        let grants = grants();
        grants.issue_document(PathBuf::from("/tmp/a.flowshark"));
        grants.issue_document(PathBuf::from("/tmp/b.flowshark"));
        grants.issue_document(PathBuf::from("/tmp/a.flowshark"));
        assert_eq!(
            grants.remembered(),
            vec![
                "/tmp/a.flowshark".to_string(),
                "/tmp/b.flowshark".to_string()
            ]
        );
    }

    #[test]
    fn the_remembered_list_is_bounded() {
        let grants = grants();
        for i in 0..(MAX_REMEMBERED + 10) {
            grants.issue_document(PathBuf::from(format!("/tmp/{i}.flowshark")));
        }
        assert_eq!(grants.remembered().len(), MAX_REMEMBERED);
    }

    #[test]
    fn clearing_the_menu_withdraws_the_ability_to_reopen() {
        let grants = grants();
        grants.issue_document(PathBuf::from("/tmp/a.flowshark"));
        grants.forget_remembered();
        assert!(grants.remembered().is_empty());
        assert!(grants.grant_remembered("/tmp/a.flowshark").is_none());
    }

    #[test]
    fn the_live_table_does_not_grow_without_bound() {
        let grants = grants();
        for i in 0..(MAX_LIVE_GRANTS + 50) {
            grants.issue(
                PathBuf::from(format!("/tmp/{i}.png")),
                true,
                false,
                Lifetime::Session,
            );
        }
        assert!(grants.live_count() <= MAX_LIVE_GRANTS);
    }

    #[test]
    fn the_newest_grant_survives_eviction() {
        let grants = grants();
        for i in 0..(MAX_LIVE_GRANTS + 5) {
            grants.issue(
                PathBuf::from(format!("/tmp/{i}.png")),
                true,
                false,
                Lifetime::Session,
            );
        }
        let newest = grants.issue(
            PathBuf::from("/tmp/newest.png"),
            true,
            false,
            Lifetime::Session,
        );
        assert!(grants.resolve(&newest.token, Access::Read).is_ok());
    }

    #[test]
    fn remembered_documents_survive_a_restart() {
        let directory = std::env::temp_dir().join("flowshark-grants-test");
        let _ = fs::remove_dir_all(&directory);
        let store = directory.join("recent.json");

        let first = grants();
        first.load(store.clone());
        first.issue_document(PathBuf::from("/tmp/kept.flowshark"));

        let second = grants();
        second.load(store);
        assert_eq!(second.remembered(), vec!["/tmp/kept.flowshark".to_string()]);
        // And the reopened list still gates what may be granted.
        assert!(second.grant_remembered("/tmp/kept.flowshark").is_some());
        assert!(second.grant_remembered("/tmp/other.flowshark").is_none());

        let _ = fs::remove_dir_all(&directory);
    }
}
