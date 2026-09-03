//! What the launcher built, so it can tell whether it still holds.
//!
//! A built archive is a function of **two** inputs, not one: the recipe, and
//! the player's own tables. ADR 0009 §4 names both, and the second is the one
//! that is easy to forget and produces the worst failure — a patch silently
//! built from tables the client no longer has, after a repair or a reinstall.
//!
//! So the record is not "we installed version 3". It is "we wrote *these* bytes
//! from *those* source tables", and every start checks all of it.
//!
//! ## Why hashing is the whole of Tier 3b
//!
//! ADR 0009 §5 anchors the built archive against "the hash the launcher
//! computed when it built it", and what makes that more than a tautology is
//! that [`crate::mpq::write`] is deterministic: same recipe, same sources,
//! byte-identical archive. Given that, comparing the recorded hashes is
//! equivalent to rebuilding and comparing, and costs two file reads instead of
//! a rebuild on every start. `rebuilding_is_deterministic` in the recipe tests
//! is what that equivalence rests on; if it ever fails, this is wrong too.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{IoContext, Result};
use crate::recipe::{Built, Recipe};

/// One recipe, as last built on this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// The client it was built for. A player who points the launcher at a
    /// different install has a different set of source tables, and the entry
    /// says nothing about that one.
    pub client_root: PathBuf,
    /// Where the archive was written, relative to the client root.
    pub output: String,
    /// The version, hash and source tables, straight from the build.
    pub built: Built,
}

/// Every recipe this launcher has built, keyed by recipe id.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Ledger {
    pub entries: Vec<Entry>,
}

impl Ledger {
    /// A ledger that fails to parse is a ledger from a newer launcher, or one
    /// half-written by a machine that lost power. Starting from empty means the
    /// worst case is rebuilding a patch that was already correct, which is
    /// slow; refusing to start would be worse.
    pub fn load(path: &Path) -> Ledger {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).at(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self).expect("a ledger is plain data");
        std::fs::write(path, bytes).at(path)
    }

    pub fn get(&self, recipe_id: &str, client_root: &Path) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|entry| entry.built.recipe_id == recipe_id && entry.client_root == client_root)
    }

    /// Record a build, replacing any earlier one for the same recipe and client.
    pub fn record(&mut self, entry: Entry) {
        self.entries.retain(|existing| {
            existing.built.recipe_id != entry.built.recipe_id
                || existing.client_root != entry.client_root
        });
        self.entries.push(entry);
    }

    pub fn forget(&mut self, recipe_id: &str, client_root: &Path) {
        self.entries
            .retain(|entry| entry.built.recipe_id != recipe_id || entry.client_root != client_root);
    }
}

/// Why the launcher is about to rebuild — or why it is not.
///
/// An enum rather than a bool because every one of these is a different
/// sentence to show a player, and "your patch is being rebuilt" with no reason
/// is the kind of thing that makes people suspect a launcher.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Need {
    /// Nothing to do: the archive is present and matches what we built.
    UpToDate,
    /// ADR 0009 §4.1 — no record of ever building this.
    NeverBuilt,
    /// §4.2 — the realm published a newer recipe.
    NewVersion { have: u32, published: u32 },
    /// §4.3 — the file we wrote is gone.
    ArchiveMissing { path: String },
    /// §4.4 — the file we wrote is not the file we wrote.
    ArchiveChanged { path: String },
    /// §4.5 — the player repaired, repacked or reinstalled their client.
    SourceChanged { table: String },
    /// The slot holds an archive that is not ours and never was. ADR 0010 §7:
    /// `patch-4.MPQ` is a convention, so a player who also plays elsewhere very
    /// likely has one, and overwriting it is destroying someone's work.
    NotOurs { path: String },
}

impl Need {
    pub fn is_up_to_date(&self) -> bool {
        matches!(self, Need::UpToDate)
    }

    /// True when building would help. `NotOurs` is the one that would not: the
    /// answer there is a person deciding, not a rebuild.
    pub fn can_build(&self) -> bool {
        !matches!(self, Need::UpToDate | Need::NotOurs { .. })
    }

    /// One line, addressed to the player.
    pub fn tell(&self) -> String {
        match self {
            Need::UpToDate => "up to date".into(),
            Need::NeverBuilt => "not built yet".into(),
            Need::NewVersion { have, published } => {
                format!("version {published} available, you have {have}")
            }
            Need::ArchiveMissing { path } => format!("{path} is missing"),
            Need::ArchiveChanged { path } => format!("{path} is not the file the launcher wrote"),
            Need::SourceChanged { table } => {
                format!("your client's {table} has changed since it was built")
            }
            Need::NotOurs { path } => {
                format!("{path} belongs to another server's patch")
            }
        }
    }
}

/// Decide what to do about one recipe, against a client on disk.
///
/// The five triggers of ADR 0009 §4, in the order that gives the most useful
/// answer: identity first, then the output, then the inputs. Checking the
/// sources before the output would report "your client changed" for a patch
/// that had simply been deleted.
pub fn need(
    recipe: &Recipe,
    entry: Option<&Entry>,
    client_root: &Path,
    locale: &str,
) -> Result<Need> {
    let output = recipe.output_path(client_root, locale);
    let shown = recipe.output_for(locale);

    let Some(entry) = entry else {
        // Nothing built here — but the slot may still be occupied, and by
        // something we must not touch.
        if output.is_file() {
            return Ok(Need::NotOurs { path: shown });
        }
        return Ok(Need::NeverBuilt);
    };

    if entry.built.version != recipe.version {
        return Ok(Need::NewVersion {
            have: entry.built.version,
            published: recipe.version,
        });
    }

    if !output.is_file() {
        return Ok(Need::ArchiveMissing { path: shown });
    }
    let bytes = std::fs::read(&output).at(&output)?;
    if blake3::hash(&bytes).to_hex().to_string() != entry.built.hash {
        return Ok(Need::ArchiveChanged { path: shown });
    }

    // The inputs last, and only when the output is already right: this is the
    // check that costs archive reads.
    // The same order the build read them under, ours excluded — see
    // `recipe::source_order`. Through the full order this would read our own
    // output back and report every table as changed.
    let order = crate::recipe::source_order(recipe, client_root, locale);
    for source in &entry.built.sources {
        let found = crate::mpq::read_effective(&order, &source.name);
        let Ok(found) = found else {
            return Ok(Need::SourceChanged {
                table: short(&source.name),
            });
        };
        if blake3::hash(&found.bytes).to_hex().to_string() != source.hash {
            return Ok(Need::SourceChanged {
                table: short(&source.name),
            });
        }
    }

    Ok(Need::UpToDate)
}

/// `DBFilesClient\ChrClasses.dbc` -> `ChrClasses.dbc`, for a sentence.
fn short(name: &str) -> String {
    name.rsplit(['\\', '/']).next().unwrap_or(name).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_table_name_shortens_to_something_a_person_reads() {
        assert_eq!(short("DBFilesClient\\ChrClasses.dbc"), "ChrClasses.dbc");
        assert_eq!(short("ChrClasses.dbc"), "ChrClasses.dbc");
    }

    #[test]
    fn the_ledger_replaces_rather_than_accumulates() {
        let built = |version: u32, hash: &str| Built {
            recipe_id: "body-types".into(),
            version,
            hash: hash.into(),
            sources: Vec::new(),
            renamed: Vec::new(),
            race_classes: 0,
        };
        let entry = |version, hash, root: &str| Entry {
            client_root: PathBuf::from(root),
            output: "Data/patch-4.MPQ".into(),
            built: built(version, hash),
        };

        let mut ledger = Ledger::default();
        ledger.record(entry(1, "aa", "/games/wow"));
        ledger.record(entry(2, "bb", "/games/wow"));
        assert_eq!(
            ledger.entries.len(),
            1,
            "the same recipe and client is one row"
        );
        assert_eq!(
            ledger
                .get("body-types", Path::new("/games/wow"))
                .unwrap()
                .built
                .version,
            2
        );

        // A second client is a second row: its tables are different, so what
        // was built for one says nothing about the other.
        ledger.record(entry(2, "cc", "/games/other"));
        assert_eq!(ledger.entries.len(), 2);
        assert_eq!(
            ledger
                .get("body-types", Path::new("/games/other"))
                .unwrap()
                .built
                .hash,
            "cc"
        );
        assert!(ledger
            .get("body-types", Path::new("/games/absent"))
            .is_none());

        ledger.forget("body-types", Path::new("/games/wow"));
        assert!(ledger.get("body-types", Path::new("/games/wow")).is_none());
        assert_eq!(ledger.entries.len(), 1);
    }

    #[test]
    fn a_need_knows_whether_building_would_help() {
        assert!(!Need::UpToDate.can_build());
        assert!(Need::NeverBuilt.can_build());
        assert!(Need::NewVersion {
            have: 1,
            published: 2
        }
        .can_build());
        assert!(Need::SourceChanged {
            table: "ChrClasses.dbc".into()
        }
        .can_build());
        // The one case where rebuilding is the wrong answer.
        assert!(!Need::NotOurs {
            path: "Data/patch-4.MPQ".into()
        }
        .can_build());
        assert!(Need::UpToDate.is_up_to_date());
        assert!(!Need::NeverBuilt.is_up_to_date());
    }
}
