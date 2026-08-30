//! Where a client comes from.
//!
//! There is exactly one variant, and that is the point. Under [ADR 0005] the
//! launcher fetches no Blizzard-authored bytes from anywhere, so the only
//! source it knows about is a directory the player already has. This module
//! exists to make that a named, single-variant decision in the code rather than
//! an absence someone later fills in without noticing what it means.
//!
//! [ADR 0005]: ../../../docs/decisions/0005-client-distribution.md

use std::path::{Path, PathBuf};

use crate::client::Client;
use crate::error::{Error, Result};

/// How deep below the chosen folder we will look for a client.
///
/// Two levels covers the ways people actually get this wrong — picking the
/// parent of the client folder, or picking a drive/mount root with one folder
/// in it — without turning a mis-click on `/home` into a filesystem walk.
const SEARCH_DEPTH: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientSource {
    /// A folder the player pointed at.
    Directory(PathBuf),
}

impl ClientSource {
    /// Resolve to an actual client.
    ///
    /// Players routinely select the folder *containing* their WoW folder, so a
    /// shallow search beats an error message telling them to try again.
    pub fn resolve(&self) -> Result<Client> {
        let ClientSource::Directory(chosen) = self;

        if let Ok(client) = Client::detect(chosen) {
            return Ok(client);
        }
        if let Some(found) = search(chosen, SEARCH_DEPTH) {
            return Client::detect(found);
        }
        Err(Error::NoClient(chosen.clone()))
    }
}

fn search(root: &Path, depth: usize) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;

    // Collect first so the shallowest match wins: a client one level down beats
    // one two levels down under a different branch.
    let directories: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .collect();

    for directory in &directories {
        if Client::detect(directory).is_ok() {
            return Some(directory.clone());
        }
    }
    directories
        .iter()
        .find_map(|directory| search(directory, depth - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_client(at: &Path) {
        std::fs::create_dir_all(at.join("Data/enUS")).unwrap();
        std::fs::write(at.join("Wow.exe"), b"MZ").unwrap();
    }

    #[test]
    fn resolves_a_folder_that_is_the_client() {
        let dir = tempfile::tempdir().unwrap();
        make_client(dir.path());
        let client = ClientSource::Directory(dir.path().into())
            .resolve()
            .unwrap();
        assert_eq!(client.root, dir.path());
    }

    #[test]
    fn finds_the_client_when_the_player_picked_its_parent() {
        let dir = tempfile::tempdir().unwrap();
        let client_dir = dir.path().join("World of Warcraft 3.3.5a");
        make_client(&client_dir);

        let client = ClientSource::Directory(dir.path().into())
            .resolve()
            .unwrap();
        assert_eq!(client.root, client_dir);
    }

    #[test]
    fn finds_the_client_two_levels_down_but_not_three() {
        let dir = tempfile::tempdir().unwrap();
        make_client(&dir.path().join("games/wow"));
        assert!(ClientSource::Directory(dir.path().into()).resolve().is_ok());

        let deep = tempfile::tempdir().unwrap();
        make_client(&deep.path().join("a/b/c"));
        assert!(matches!(
            ClientSource::Directory(deep.path().into()).resolve(),
            Err(Error::NoClient(_))
        ));
    }

    #[test]
    fn an_empty_folder_reports_the_folder_the_player_chose() {
        let dir = tempfile::tempdir().unwrap();
        let error = ClientSource::Directory(dir.path().into())
            .resolve()
            .unwrap_err();
        assert!(error
            .to_string()
            .contains(&dir.path().display().to_string()));
    }
}
