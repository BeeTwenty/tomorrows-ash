//! Writing our configuration into a client directory.
//!
//! Everything here touches files the player owns, so two rules hold throughout:
//! the first time we overwrite a file we keep a copy of what was there, and we
//! only ever write files the manifest named (validated by
//! [`crate::manifest::safe_relative`] before we get here).

use std::path::{Path, PathBuf};

use crate::client::Client;
use crate::error::{Error, IoContext, Result};
use crate::manifest::{safe_relative, Patch};

/// Suffix for the one-time copy taken before we first overwrite something.
const BACKUP_SUFFIX: &str = ".ashmorrow-original";

/// Point the client at a realm.
///
/// Writes every `realmlist.wtf` the client might read — see
/// [`Client::realmlist_paths`] — and returns the ones written.
pub fn write_realmlist(client: &Client, address: &str) -> Result<Vec<PathBuf>> {
    if address.trim().is_empty() {
        return Err(Error::Message("no realm address to write".into()));
    }

    let paths = client.realmlist_paths();
    if paths.is_empty() {
        return Err(Error::NoLocale(client.root.join("Data")));
    }

    // The client reads this file as ASCII and a stray BOM or CRLF has been
    // blamed for more failed logins than anything else in fifteen years of
    // private servers. One line, LF, no BOM.
    let contents = format!("set realmlist {address}\n");

    for path in &paths {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).at(parent)?;
        }
        back_up_once(path)?;
        std::fs::write(path, &contents).at(path)?;
    }

    Ok(paths)
}

/// Pre-fill the account name on the login screen.
///
/// This is as far as ADR 0005 rule 3 lets us go towards "auto login": the
/// password field is filled by the player, because filling it would mean
/// writing into the running client's memory.
pub fn preset_account_name(client: &Client, account: &str) -> Result<PathBuf> {
    let path = client.config_wtf();
    set_config_value(&path, "accountName", account)?;
    Ok(path)
}

/// Set one `SET key "value"` line in a `.wtf` config, preserving everything else.
pub fn set_config_value(path: &Path, key: &str, value: &str) -> Result<()> {
    if value.contains('"') || value.contains('\n') {
        return Err(Error::Message(format!(
            "{key} cannot contain a quote or a newline"
        )));
    }

    let existing = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(Error::Io {
                path: path.into(),
                source: e,
            })
        }
    };

    let line = format!("SET {key} \"{value}\"");
    let mut replaced = false;
    let mut out: Vec<String> = Vec::new();

    for existing_line in existing.lines() {
        if config_key_of(existing_line).is_some_and(|k| k.eq_ignore_ascii_case(key)) {
            // Keep the first occurrence in place; drop any duplicates, which
            // the client itself produces after a crash.
            if !replaced {
                out.push(line.clone());
                replaced = true;
            }
        } else {
            out.push(existing_line.to_string());
        }
    }
    if !replaced {
        out.push(line);
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).at(parent)?;
    }
    back_up_once(path)?;
    out.push(String::new()); // trailing newline
    std::fs::write(path, out.join("\n")).at(path)
}

/// The key in a `SET key "value"` line, if the line is one.
fn config_key_of(line: &str) -> Option<&str> {
    let rest = line.trim_start();
    let rest = rest
        .strip_prefix("SET ")
        .or_else(|| rest.strip_prefix("set "))?;
    rest.split_whitespace().next()
}

/// Install one of our own patch files, given bytes already fetched.
///
/// The hash is checked *before* anything is written, so a corrupted or
/// tampered download never lands in the game directory even briefly.
pub fn install_patch(root: &Path, patch: &Patch, bytes: &[u8]) -> Result<PathBuf> {
    let relative = safe_relative(&patch.path)?;

    let found = blake3::hash(bytes).to_hex().to_string();
    if !found.eq_ignore_ascii_case(&patch.hash) {
        return Err(Error::Message(format!(
            "{} does not match its published hash — expected {}, got {found}. Nothing was written.",
            patch.id, patch.hash
        )));
    }
    if bytes.len() as u64 != patch.size {
        return Err(Error::Message(format!(
            "{} is {} bytes, the manifest says {}. Nothing was written.",
            patch.id,
            bytes.len(),
            patch.size
        )));
    }

    let destination = root.join(&relative);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).at(parent)?;
    }

    // Write beside the target and rename, so an interrupted install leaves the
    // previous file intact rather than a half-written one the client will load.
    let temporary = destination.with_extension("ashmorrow-part");
    std::fs::write(&temporary, bytes).at(&temporary)?;
    std::fs::rename(&temporary, &destination).at(&destination)?;

    Ok(destination)
}

/// Copy a file to `<name>.ashmorrow-original` the first time we touch it.
///
/// Once only: the point is to preserve what the player had before this launcher
/// ever ran, not to keep a rolling history of our own writes.
fn back_up_once(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut backup = path.as_os_str().to_os_string();
    backup.push(BACKUP_SUFFIX);
    let backup = PathBuf::from(backup);
    if backup.exists() {
        return Ok(());
    }
    std::fs::copy(path, &backup).at(&backup)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Manifest;

    fn client_at(root: &Path, locale: &str) -> Client {
        std::fs::create_dir_all(root.join("Data").join(locale)).unwrap();
        std::fs::write(root.join("Wow.exe"), b"MZ not really").unwrap();
        Client::detect(root).unwrap()
    }

    #[test]
    fn writes_one_realmlist_line_per_locale() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Data/deDE")).unwrap();
        let client = client_at(dir.path(), "enUS");

        let written = write_realmlist(&client, "play.ashmorrow.example").unwrap();
        assert_eq!(
            written.len(),
            2,
            "both locale directories should be written"
        );
        for path in written {
            let text = std::fs::read_to_string(&path).unwrap();
            assert_eq!(text, "set realmlist play.ashmorrow.example\n");
        }
    }

    #[test]
    fn keeps_the_players_original_realmlist_once() {
        let dir = tempfile::tempdir().unwrap();
        let client = client_at(dir.path(), "enUS");
        let realmlist = dir.path().join("Data/enUS/realmlist.wtf");
        std::fs::write(&realmlist, "set realmlist logon.someoneelse.example\n").unwrap();

        write_realmlist(&client, "first.example").unwrap();
        write_realmlist(&client, "second.example").unwrap();

        let backup = std::fs::read_to_string(
            realmlist.with_file_name(format!("realmlist.wtf{BACKUP_SUFFIX}")),
        )
        .unwrap();
        assert!(
            backup.contains("someoneelse"),
            "the backup must hold what was there before we ever wrote, not our own first write"
        );
    }

    #[test]
    fn replaces_a_config_value_in_place_and_leaves_the_rest_alone() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("WTF/Config.wtf");
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        std::fs::write(
            &config,
            "SET locale \"enUS\"\nSET accountName \"OLDNAME\"\nSET gxApi \"d3d9\"\n",
        )
        .unwrap();

        set_config_value(&config, "accountName", "ashadmin").unwrap();

        let text = std::fs::read_to_string(&config).unwrap();
        assert!(text.contains("SET accountName \"ashadmin\""));
        assert!(text.contains("SET locale \"enUS\""));
        assert!(text.contains("SET gxApi \"d3d9\""));
        assert!(!text.contains("OLDNAME"));
        // Order preserved: accountName stays in the middle.
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[1], "SET accountName \"ashadmin\"");
    }

    #[test]
    fn collapses_duplicate_keys_the_client_leaves_behind() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("Config.wtf");
        std::fs::write(&config, "SET accountName \"A\"\nSET accountName \"B\"\n").unwrap();

        set_config_value(&config, "accountName", "C").unwrap();

        let text = std::fs::read_to_string(&config).unwrap();
        assert_eq!(text.matches("accountName").count(), 1);
        assert!(text.contains("\"C\""));
    }

    #[test]
    fn appends_a_key_that_was_not_there() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("Config.wtf");
        std::fs::write(&config, "SET locale \"enUS\"\n").unwrap();

        set_config_value(&config, "gxApi", "opengl").unwrap();

        let text = std::fs::read_to_string(&config).unwrap();
        assert!(text.contains("SET locale \"enUS\""));
        assert!(text.contains("SET gxApi \"opengl\""));
    }

    #[test]
    fn refuses_a_value_that_would_break_out_of_its_quotes() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("Config.wtf");
        assert!(set_config_value(&config, "accountName", "evil\" SET x \"").is_err());
    }

    fn patch_manifest(hash: &str, size: u64) -> Manifest {
        let json = format!(
            r#"{{"schema":1,
                 "realm":{{"name":"A","address":"a.example"}},
                 "client":{{"build":12340,"version":"3.3.5"}},
                 "patches":[{{"id":"ash-base","version":1,"path":"Data/patch-4.MPQ",
                              "size":{size},"hash":"{hash}",
                              "url":"https://patches.ashmorrow.example/base.mpq"}}]}}"#
        );
        Manifest::parse(json.as_bytes()).unwrap()
    }

    #[test]
    fn installs_a_patch_that_matches_its_hash() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"our own patch contents";
        let manifest = patch_manifest(&blake3::hash(bytes).to_hex(), bytes.len() as u64);

        let written = install_patch(dir.path(), &manifest.patches[0], bytes).unwrap();
        assert_eq!(std::fs::read(&written).unwrap(), bytes);
    }

    #[test]
    fn refuses_a_patch_whose_bytes_do_not_match_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = patch_manifest(&blake3::hash(b"expected").to_hex(), 8);

        let error = install_patch(dir.path(), &manifest.patches[0], b"tampered").unwrap_err();
        assert!(error.to_string().contains("Nothing was written"));
        assert!(!dir.path().join("Data/patch-4.MPQ").exists());
        // And no partial file left lying around either.
        assert!(!dir.path().join("Data/patch-4.ashmorrow-part").exists());
    }
}
