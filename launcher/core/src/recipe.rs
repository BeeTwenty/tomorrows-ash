//! The body-type client patch, as instructions rather than as a file.
//!
//! [ADR 0008](../../../docs/decisions/0008-body-type-client-patch.md) §4: we
//! never ship an edited `ChrClasses.dbc`. A Blizzard table with three strings
//! changed is still Blizzard's table, and [ADR 0005] rule 2 says our patch
//! channel carries only what we authored. So what we publish is a few kilobytes
//! of *edits* — rename this class, keep these three, add these race rows — and
//! the launcher reads the player's own DBCs out of the player's own archives,
//! applies them, and writes the archive locally.
//!
//! That is better than shipping the table on three counts beyond the legal one:
//! one recipe serves every locale, a repacked client still gets a correct patch
//! because we edit *its* tables, and "rename class 2 to Vanguard" is reviewable
//! in a pull request in a way that a binary blob is not.
//!
//! [ADR 0005]: ../../../docs/decisions/0005-client-distribution.md

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::dbc::{self, Dbc, RaceClass, LOCALES};
use crate::error::{Error, IoContext, Result};
use crate::mpq;

/// Bumped only when a change would make an older launcher misread a recipe.
pub const SCHEMA_VERSION: u32 = 1;

/// What the launcher is told to do to a client's tables.
///
/// `deny_unknown_fields` for the same reason the manifest has it: a field this
/// launcher does not understand is a change it cannot apply correctly, and
/// silently ignoring it would produce a client that is patched, looks patched,
/// and is wrong.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Recipe {
    /// Prose for whoever edits the file. Ignored by every reader, and present
    /// because the case for shipping instructions instead of a binary is that
    /// a human reviews them.
    #[serde(rename = "$comment", default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<serde_json::Value>,
    pub schema: u32,
    /// Stable across versions. Names the ledger entry and the output file.
    pub id: String,
    /// Increments whenever anything below changes. See `docs/decisions/0009`.
    pub version: u32,
    /// The commit this recipe was published from. Stamped by CI, never by hand.
    #[serde(default)]
    pub revision: String,
    /// Where the built archive goes, relative to the client root.
    pub output: String,
    #[serde(default)]
    pub summary: String,
    pub chr_classes: ClassEdits,
    pub char_base_info: RaceEdits,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ClassEdits {
    /// Which column holds the class ID.
    pub id_field: usize,
    /// The first of the sixteen locale columns of `Name_Lang`.
    ///
    /// Carried as data rather than compiled in: it is a fact about the client's
    /// table layout, and if a repack moves it, that is a reviewed recipe change
    /// and not a new launcher.
    pub name_field: usize,
    pub rename: Vec<Rename>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Rename {
    pub class: u32,
    pub to: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RaceEdits {
    /// Classes a character may be created as. Everything else is removed.
    pub keep_classes: Vec<u8>,
    /// Race/class pairs to add — the combinations Blizzard never shipped and
    /// the server now accepts.
    pub add: Vec<RaceClassRow>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RaceClassRow {
    pub race: u8,
    pub class: u8,
}

impl Recipe {
    pub fn parse(bytes: &[u8]) -> Result<Recipe> {
        let recipe: Recipe = serde_json::from_slice(bytes)
            .map_err(|e| Error::Message(format!("this recipe could not be read: {e}")))?;
        recipe.validate()?;
        Ok(recipe)
    }

    fn validate(&self) -> Result<()> {
        if self.schema != SCHEMA_VERSION {
            return Err(Error::Message(format!(
                "this recipe is schema {}, and this launcher reads {SCHEMA_VERSION}. \
                 Update the launcher.",
                self.schema
            )));
        }
        if self.id.trim().is_empty() {
            return Err(Error::Message("a recipe needs an id".into()));
        }
        if self.version == 0 {
            return Err(Error::Message("recipe versions start at 1".into()));
        }
        // The output path is written into the player's game directory, so it
        // gets exactly the treatment every other path we are handed gets.
        //
        // `crate::manifest::safe_relative` rather than `Path::is_absolute`,
        // which is the trap: `/etc/patch.MPQ` is *not* absolute to Windows —
        // there is no drive letter to anchor it — and `join` on Windows then
        // treats it as rooted and drops the client directory entirely. The
        // Windows leg of CI caught exactly this.
        crate::manifest::safe_relative(&self.output)?;
        if !self.output.to_ascii_lowercase().ends_with(".mpq") {
            return Err(Error::Message(format!(
                "a recipe builds an MPQ archive, and {} is not one",
                self.output
            )));
        }
        if self.chr_classes.rename.is_empty() && self.char_base_info.keep_classes.is_empty() {
            return Err(Error::Message(
                "this recipe would change nothing; a patch that does nothing is worse \
                 than no patch, because it still shadows another server's"
                    .into(),
            ));
        }
        Ok(())
    }

    /// Where the built archive goes.
    ///
    /// Safe to join: `validate` has already refused anything that is not a
    /// plain relative path, on every platform rather than on this one.
    pub fn output_path(&self, client_root: &Path) -> PathBuf {
        client_root.join(&self.output)
    }
}

/* ------------------------------------------------------------------ *
 * Applying it
 * ------------------------------------------------------------------ */

/// What a build actually did, for the report and for the ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Built {
    pub recipe_id: String,
    pub version: u32,
    /// BLAKE3 of the archive that was written. The launcher has no server-side
    /// hash to compare against — the archive is built from the player's own
    /// bytes and differs per client — so this is the expected value from here
    /// on, and `mpq::write` is deterministic to make that mean something.
    pub hash: String,
    /// The tables it was built from, so a client that changes underneath it
    /// triggers a rebuild rather than a mystery.
    pub sources: Vec<SourceTable>,
    pub renamed: Vec<String>,
    pub race_classes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceTable {
    pub name: String,
    /// The archive it was read from, for a report that has to explain itself.
    pub archive: String,
    pub hash: String,
}

/// Apply a recipe to a client's two tables, returning the edited pair.
///
/// Pure: no filesystem, no archives. Everything here is testable against tables
/// built in a test, which is the whole reason it is separate from `build`.
pub fn apply(recipe: &Recipe, classes: &Dbc, races: &Dbc) -> Result<(Dbc, Dbc)> {
    let classes = rename_classes(recipe, classes)?;
    let races = rebuild_race_table(recipe, races)?;
    Ok((classes, races))
}

fn rename_classes(recipe: &Recipe, source: &Dbc) -> Result<Dbc> {
    let edits = &recipe.chr_classes;
    let last_field = edits.name_field + LOCALES;
    let need = (last_field + 1) * 4;
    if (source.record_size as usize) < need {
        return Err(Error::Message(format!(
            "this recipe expects ChrClasses to have a Name_Lang field at column {}, which needs \
             records of at least {need} bytes; this client's are {}. The recipe's name_field is \
             wrong for this client.",
            edits.name_field, source.record_size
        )));
    }

    let mut table = source.clone();
    for rename in &edits.rename {
        let mut found = false;
        for index in 0..table.record_count() {
            if table.u32_field(index, edits.id_field)? != rename.class {
                continue;
            }
            // A structural check that the recipe is pointing at strings and not
            // at, say, the flags column: at least one locale column of this row
            // must already hold a non-empty name.
            let plausible = (0..LOCALES).any(|locale| {
                table
                    .localised(index, edits.name_field, locale)
                    .is_ok_and(|text| !text.is_empty())
            });
            if !plausible {
                return Err(Error::Message(format!(
                    "class {} has no name at column {} in this client, so the recipe is \
                     pointing at the wrong field and renaming it would corrupt the table",
                    rename.class, edits.name_field
                )));
            }
            table.set_localised(index, edits.name_field, &rename.to)?;
            found = true;
            break;
        }
        if !found {
            return Err(Error::Message(format!(
                "this client's ChrClasses has no class {}, so the recipe does not fit it",
                rename.class
            )));
        }
    }
    Ok(table)
}

fn rebuild_race_table(recipe: &Recipe, source: &Dbc) -> Result<Dbc> {
    // Read it first: this is the table whose two-byte records break the usual
    // assumptions, and reading it wrong here would silently empty the character
    // creation screen.
    let existing = dbc::race_classes(source)?;
    let keep = &recipe.char_base_info.keep_classes;

    let mut rows: Vec<RaceClass> = existing
        .into_iter()
        .filter(|row| keep.contains(&row.class))
        .collect();
    for add in &recipe.char_base_info.add {
        rows.push(RaceClass {
            race: add.race,
            class: add.class,
        });
    }
    // Sorted and deduplicated so that the same recipe on the same client always
    // produces the same bytes — the archive is verified against a hash we took
    // ourselves, and a table whose row order wandered would fail that check on
    // the next start for no reason.
    rows.sort_unstable();
    rows.dedup();

    if rows.is_empty() {
        return Err(Error::Message(
            "this recipe would leave no race able to create a character".into(),
        ));
    }

    let mut table = source.empty_like();
    for row in &rows {
        table.push(&[row.race, row.class])?;
    }
    Ok(table)
}

/* ------------------------------------------------------------------ *
 * Building it against a real client
 * ------------------------------------------------------------------ */

/// Read a client's tables, apply the recipe, and return the archive's bytes.
///
/// Does not write anything: the caller decides where it goes and whether it is
/// allowed to (see `would_clobber`).
pub fn build(recipe: &Recipe, client_root: &Path, locale: &str) -> Result<(Vec<u8>, Built)> {
    let archives = mpq::load_order(client_root, locale);
    if archives.is_empty() {
        return Err(Error::Message(format!(
            "no MPQ archives under {}/Data — this does not look like a client",
            client_root.display()
        )));
    }

    let mut sources = Vec::new();
    let mut read = |name: &str| -> Result<Dbc> {
        let found = mpq::read_effective(&archives, name)?;
        sources.push(SourceTable {
            name: name.to_string(),
            archive: found
                .archive
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            hash: blake3::hash(&found.bytes).to_hex().to_string(),
        });
        Dbc::parse(&found.bytes)
    };

    let classes = read(dbc::CHR_CLASSES)?;
    let races = read(dbc::CHAR_BASE_INFO)?;

    let (classes, races) = apply(recipe, &classes, &races)?;
    let race_classes = races.record_count();

    let archive = mpq::write(&[
        (dbc::CHR_CLASSES.to_string(), classes.write()),
        (dbc::CHAR_BASE_INFO.to_string(), races.write()),
    ])?;

    Ok((
        archive.clone(),
        Built {
            recipe_id: recipe.id.clone(),
            version: recipe.version,
            hash: blake3::hash(&archive).to_hex().to_string(),
            sources,
            renamed: recipe
                .chr_classes
                .rename
                .iter()
                .map(|r| r.to.clone())
                .collect(),
            race_classes,
        },
    ))
}

/// Is there already a patch in this slot that is not one of ours?
///
/// `patch-4.MPQ` is a convention, which means every custom server uses it. A
/// player who also plays elsewhere very likely has one, and overwriting it
/// silently would break their other client and produce a character creation
/// screen belonging to neither realm. ADR 0008 §7.
pub fn would_clobber(recipe: &Recipe, client_root: &Path, ours: Option<&str>) -> Result<bool> {
    let path = recipe.output_path(client_root);
    if !path.is_file() {
        return Ok(false);
    }
    let bytes = std::fs::read(&path).at(&path)?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    Ok(Some(hash.as_str()) != ours)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recipe_json() -> String {
        serde_json::json!({
            "schema": 1,
            "id": "body-types",
            "version": 1,
            "output": "Data/patch-4.MPQ",
            "chr_classes": {
                "id_field": 0,
                "name_field": 1,
                "rename": [
                    {"class": 2, "to": "Vanguard"},
                    {"class": 7, "to": "Skirmisher"},
                    {"class": 8, "to": "Adept"}
                ]
            },
            "char_base_info": {
                "keep_classes": [2, 7, 8],
                "add": [{"race": 4, "class": 2}]
            }
        })
        .to_string()
    }

    /// `ChrClasses`-shaped: an ID column then a `_Lang` field.
    fn classes() -> Dbc {
        let bytes = {
            let field_count = 1 + LOCALES as u32 + 1;
            let record_size = field_count * 4;
            let mut records = Vec::new();
            let mut strings = vec![0u8];
            let intern = |text: &str, strings: &mut Vec<u8>| {
                let at = strings.len() as u32;
                strings.extend_from_slice(text.as_bytes());
                strings.push(0);
                at
            };
            for (id, name) in [
                (1u32, "Warrior"),
                (2, "Paladin"),
                (7, "Shaman"),
                (8, "Mage"),
            ] {
                let offset = intern(name, &mut strings);
                records.extend_from_slice(&id.to_le_bytes());
                for locale in 0..LOCALES {
                    // Only the installed locale is populated in a real client.
                    records.extend_from_slice(&if locale == 0 { offset } else { 0 }.to_le_bytes());
                }
                records.extend_from_slice(&0u32.to_le_bytes());
            }
            let mut out = b"WDBC".to_vec();
            out.extend_from_slice(&4u32.to_le_bytes());
            out.extend_from_slice(&field_count.to_le_bytes());
            out.extend_from_slice(&record_size.to_le_bytes());
            out.extend_from_slice(&(strings.len() as u32).to_le_bytes());
            out.extend_from_slice(&records);
            out.extend_from_slice(&strings);
            out
        };
        Dbc::parse(&bytes).unwrap()
    }

    fn races(rows: &[(u8, u8)]) -> Dbc {
        let mut records = Vec::new();
        for (race, class) in rows {
            records.push(*race);
            records.push(*class);
        }
        let mut out = b"WDBC".to_vec();
        out.extend_from_slice(&(rows.len() as u32).to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&records);
        out.push(0);
        Dbc::parse(&out).unwrap()
    }

    #[test]
    fn a_recipe_round_trips_through_json() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        assert_eq!(recipe.id, "body-types");
        let again = Recipe::parse(serde_json::to_vec(&recipe).unwrap().as_slice()).unwrap();
        assert_eq!(recipe, again);
    }

    #[test]
    fn an_unknown_field_is_refused_rather_than_ignored() {
        let mut value: serde_json::Value = serde_json::from_str(&recipe_json()).unwrap();
        value["url"] = serde_json::json!("https://example.invalid/patch.MPQ");
        let error = Recipe::parse(value.to_string().as_bytes())
            .unwrap_err()
            .to_string();
        assert!(error.contains("url"), "unhelpful: {error}");
    }

    /// Every one of these is harmless-looking on at least one platform and an
    /// escape on the other, which is why the check cannot be `is_absolute`.
    #[test]
    fn an_output_that_escapes_the_client_is_refused() {
        for bad in [
            "../../etc/patch.MPQ",
            "/etc/patch.MPQ",
            "//server/share/patch.MPQ",
            "C:/Windows/patch.MPQ",
            "..\\..\\windows\\patch.MPQ",
            "Data/../../patch.MPQ",
        ] {
            let mut value: serde_json::Value = serde_json::from_str(&recipe_json()).unwrap();
            value["output"] = serde_json::json!(bad);
            assert!(
                Recipe::parse(value.to_string().as_bytes()).is_err(),
                "{bad} was accepted as an output path"
            );
        }
    }

    #[test]
    fn renaming_leaves_the_classes_it_was_not_asked_about_alone() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let (classes, _) = apply(&recipe, &classes(), &races(&[(1, 2)])).unwrap();
        let name = |id: u32| {
            (0..classes.record_count())
                .find(|&i| classes.u32_field(i, 0).unwrap() == id)
                .map(|i| classes.localised(i, 1, 0).unwrap().to_string())
                .unwrap()
        };
        assert_eq!(name(1), "Warrior", "a class we did not rename changed");
        assert_eq!(name(2), "Vanguard");
        assert_eq!(name(7), "Skirmisher");
        assert_eq!(name(8), "Adept");
    }

    #[test]
    fn the_rename_reaches_every_locale_a_client_might_be_installed_in() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let (classes, _) = apply(&recipe, &classes(), &races(&[(1, 2)])).unwrap();
        let row = (0..classes.record_count())
            .find(|&i| classes.u32_field(i, 0).unwrap() == 2)
            .unwrap();
        for locale in 0..LOCALES {
            assert_eq!(
                classes.localised(row, 1, locale).unwrap(),
                "Vanguard",
                "a deDE client would still see Paladin (locale column {locale})"
            );
        }
    }

    #[test]
    fn the_race_table_keeps_three_classes_and_gains_the_missing_rows() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let before = races(&[(1, 1), (1, 2), (1, 8), (4, 1), (4, 5), (6, 7)]);
        let (_, after) = apply(&recipe, &classes(), &before).unwrap();
        assert_eq!(
            dbc::race_classes(&after).unwrap(),
            vec![
                RaceClass { race: 1, class: 2 },
                RaceClass { race: 1, class: 8 },
                RaceClass { race: 4, class: 2 }, // added: Night Elf, which had none
                RaceClass { race: 6, class: 7 },
            ],
            "every class that is not a body type must go, and the added rows must arrive"
        );
    }

    #[test]
    fn adding_a_row_that_is_already_there_does_not_duplicate_it() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let (_, after) = apply(&recipe, &classes(), &races(&[(4, 2), (1, 2)])).unwrap();
        assert_eq!(
            dbc::race_classes(&after).unwrap(),
            vec![
                RaceClass { race: 1, class: 2 },
                RaceClass { race: 4, class: 2 },
            ]
        );
    }

    #[test]
    fn a_name_field_that_is_wrong_for_this_client_is_refused_not_applied() {
        let mut value: serde_json::Value = serde_json::from_str(&recipe_json()).unwrap();
        // Past the end of the record: the client's table is a different shape.
        value["chr_classes"]["name_field"] = serde_json::json!(90);
        let recipe = Recipe::parse(value.to_string().as_bytes()).unwrap();
        let error = apply(&recipe, &classes(), &races(&[(1, 2)]))
            .unwrap_err()
            .to_string();
        assert!(error.contains("name_field"), "unhelpful: {error}");
    }

    #[test]
    fn a_recipe_for_a_class_this_client_does_not_have_is_refused() {
        let mut value: serde_json::Value = serde_json::from_str(&recipe_json()).unwrap();
        value["chr_classes"]["rename"] = serde_json::json!([{"class": 99, "to": "Nothing"}]);
        let recipe = Recipe::parse(value.to_string().as_bytes()).unwrap();
        let error = apply(&recipe, &classes(), &races(&[(1, 2)]))
            .unwrap_err()
            .to_string();
        assert!(error.contains("class 99"), "unhelpful: {error}");
    }

    #[test]
    fn a_recipe_that_would_empty_the_creation_screen_is_refused() {
        let mut value: serde_json::Value = serde_json::from_str(&recipe_json()).unwrap();
        value["char_base_info"]["keep_classes"] = serde_json::json!([2]);
        value["char_base_info"]["add"] = serde_json::json!([]);
        let recipe = Recipe::parse(value.to_string().as_bytes()).unwrap();
        // No race has class 2 here, so the filter empties the table.
        let error = apply(&recipe, &classes(), &races(&[(1, 1), (4, 5)]))
            .unwrap_err()
            .to_string();
        assert!(error.contains("no race"), "unhelpful: {error}");
    }

    /// The launcher verifies this archive against a hash it computed itself
    /// when it built it, so a rebuild from the same inputs has to be identical.
    #[test]
    fn building_the_same_recipe_twice_gives_the_same_bytes() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let build = || {
            let (classes, races) = apply(&recipe, &classes(), &races(&[(1, 2), (6, 7)])).unwrap();
            mpq::write(&[
                (dbc::CHR_CLASSES.to_string(), classes.write()),
                (dbc::CHAR_BASE_INFO.to_string(), races.write()),
            ])
            .unwrap()
        };
        assert_eq!(build(), build());
    }

    /// The built archive has to be readable as an archive, or the game will not
    /// load it and nothing else here matters.
    #[test]
    fn the_built_archive_reads_back_as_the_edited_tables() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let (classes, races) = apply(&recipe, &classes(), &races(&[(1, 2), (6, 7)])).unwrap();
        let bytes = mpq::write(&[
            (dbc::CHR_CLASSES.to_string(), classes.write()),
            (dbc::CHAR_BASE_INFO.to_string(), races.write()),
        ])
        .unwrap();

        let archive = mpq::Archive::parse(bytes).unwrap();
        let back = Dbc::parse(&archive.read(dbc::CHR_CLASSES).unwrap()).unwrap();
        let row = (0..back.record_count())
            .find(|&i| back.u32_field(i, 0).unwrap() == 2)
            .unwrap();
        assert_eq!(back.localised(row, 1, 0).unwrap(), "Vanguard");

        let back = Dbc::parse(&archive.read(dbc::CHAR_BASE_INFO).unwrap()).unwrap();
        assert_eq!(dbc::race_classes(&back).unwrap().len(), 3);
    }

    #[test]
    fn a_patch_slot_holding_someone_elses_archive_is_noticed() {
        let recipe = Recipe::parse(recipe_json().as_bytes()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = recipe.output_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();

        assert!(
            !would_clobber(&recipe, dir.path(), None).unwrap(),
            "nothing there yet"
        );

        std::fs::write(&path, b"another server's patch").unwrap();
        assert!(would_clobber(&recipe, dir.path(), None).unwrap());

        let ours = blake3::hash(b"another server's patch").to_hex().to_string();
        assert!(
            !would_clobber(&recipe, dir.path(), Some(&ours)).unwrap(),
            "our own archive must not look like someone else's"
        );
    }
}
