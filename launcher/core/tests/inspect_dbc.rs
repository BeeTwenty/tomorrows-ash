//! `inspect-dbc` against a client-shaped archive.
//!
//! The tool exists to read a *real* client, and this cannot be that: the
//! archive here is one we wrote, so it proves the reader agrees with our
//! writer rather than with Blizzard's. What it does prove is the whole path —
//! load order, archive, DBC header, string block, the name-column search and
//! the matrix — against `ChrClasses` laid out the way the core's own loader
//! parses it, decoy column and all.

mod common;

use std::path::Path;
use std::process::Command;

use common::{StringBlock, F_NAME_LANG, F_PET_NAME};
use launcher_core::dbc::{self, Dbc};
use launcher_core::mpq;

fn fake_client(root: &Path, block: StringBlock) {
    let locale = root.join("Data/enUS");
    std::fs::create_dir_all(&locale).unwrap();

    // Enough of a PE for the version reader: 3.3.5 build 12340.
    let mut exe = b"MZ".to_vec();
    exe.extend_from_slice(&[0x11; 30]);
    exe.extend_from_slice(&[0xBD, 0x04, 0xEF, 0xFE]);
    exe.extend_from_slice(&0x0001_0000u32.to_le_bytes());
    exe.extend_from_slice(&((3u32 << 16) | 3).to_le_bytes());
    exe.extend_from_slice(&((5u32 << 16) | 12340).to_le_bytes());
    std::fs::write(root.join("Wow.exe"), exe).unwrap();

    // The base archive holds a stale ChrClasses; the patch archive holds the
    // real one. Reading the base and calling it the answer is the mistake this
    // arrangement exists to catch.
    let stale = {
        let mut table = Dbc::parse(&common::chr_classes(block)).unwrap();
        table.set_localised(0, F_NAME_LANG, "Stale").unwrap();
        table.write()
    };
    std::fs::write(
        locale.join("locale-enUS.MPQ"),
        mpq::write(&[
            (dbc::CHR_CLASSES.to_string(), stale),
            (dbc::CHAR_BASE_INFO.to_string(), common::char_base_info()),
        ])
        .unwrap(),
    )
    .unwrap();
    std::fs::write(
        locale.join("patch-enUS-3.MPQ"),
        mpq::write(&[(dbc::CHR_CLASSES.to_string(), common::chr_classes(block))]).unwrap(),
    )
    .unwrap();
}

fn run(root: &Path) -> (String, String, bool) {
    let output = Command::new(env!("CARGO_BIN_EXE_ashmorrow-manifest"))
        .args(["inspect-dbc", &root.to_string_lossy()])
        .output()
        .expect("the tool should run");
    (
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
        output.status.success(),
    )
}

#[test]
fn inspect_dbc_reads_a_clients_tables_and_reports_the_matrix() {
    let dir = tempfile::tempdir().unwrap();
    fake_client(dir.path(), StringBlock::Conventional);

    let (text, errors, ok) = run(dir.path());
    assert!(ok, "inspect-dbc failed\nstdout:\n{text}\nstderr:\n{errors}");

    // `SHOW=1 cargo test --test inspect_dbc -- --nocapture` prints the report,
    // which is the quickest way to see what a real client will produce.
    if std::env::var_os("SHOW").is_some() {
        println!("{text}");
    }

    assert!(
        text.contains(&format!("Name_Lang is field {F_NAME_LANG}")),
        "did not identify the name column:\n{text}"
    );
    // It read the patch archive's table, not the base archive's stale one.
    assert!(text.contains("Warrior"), "class names missing:\n{text}");
    assert!(!text.contains("Stale"), "read the shadowed table:\n{text}");
    assert!(text.contains("patch-enUS-3.MPQ"), "wrong archive:\n{text}");
    // And it noticed the shape of CharBaseInfo.
    assert!(
        text.contains("not four bytes per field"),
        "did not flag the two-byte records:\n{text}"
    );
    assert!(text.contains("race x class"), "no matrix:\n{text}");
}

/// The bug a real client found: `PetNameToken` is a string column that comes
/// *before* the name, so "the first column that holds text" is the wrong one.
///
/// Field 3 must be visible as a candidate — it genuinely holds strings — and
/// must lose, because reading it as the start of a sixteen-column block puts
/// the real name column inside it, which is the bleed the report names.
#[test]
fn the_pet_name_column_does_not_win_the_name_column() {
    let dir = tempfile::tempdir().unwrap();
    fake_client(dir.path(), StringBlock::Conventional);
    let (text, _, ok) = run(dir.path());
    assert!(ok);

    assert!(
        text.contains(&format!("Name_Lang is field {F_NAME_LANG}")),
        "picked something other than the name column:\n{text}"
    );
    assert!(
        !text.contains(&format!("Name_Lang is field {F_PET_NAME}")),
        "picked the pet-name token:\n{text}"
    );
    // Every class is named, and none is named after a pet token.
    for name in ["Warrior", "Paladin", "Hunter", "Mage", "Druid"] {
        assert!(
            text.contains(name),
            "{name} missing from the report:\n{text}"
        );
    }
    assert!(
        !text.lines().any(|l| l.trim_start().starts_with("1    PET")),
        "class 1 printed as a pet token:\n{text}"
    );
}

/// A table repacked without the leading NUL, which is what a client patched by
/// a third-party tool looks like. Offset zero is then a real string, so every
/// empty reference reads as that string — and a column of blank pet tokens
/// prints as ten convincing names.
///
/// This is the exact shape of the first real-client run: nine rows "PET" and
/// one "DEMON". Detection has to survive it.
#[test]
fn a_repacked_string_block_does_not_turn_blanks_into_names() {
    let dir = tempfile::tempdir().unwrap();
    fake_client(dir.path(), StringBlock::NoLeadingNul);
    let (text, _, ok) = run(dir.path());
    assert!(ok, "{text}");

    assert!(
        text.contains(&format!("Name_Lang is field {F_NAME_LANG}")),
        "a repacked string block defeated the name search:\n{text}"
    );
    assert!(
        text.contains("NOT a NUL"),
        "the report should say the block was repacked:\n{text}"
    );
    for name in ["Warrior", "Paladin", "Hunter"] {
        assert!(text.contains(name), "{name} missing:\n{text}");
    }
}

/// Offset zero means "no string", whatever byte happens to be there.
///
/// The measured client keeps the convention — its block does open with a NUL —
/// so this is hardening rather than a fix for what was actually seen. It still
/// matters: a repacked table that drops the NUL makes every empty reference
/// read as the first string in the block, and nothing about that is visible in
/// the output it produces.
#[test]
fn offset_zero_is_empty_even_when_the_block_does_not_start_with_a_nul() {
    let conventional = Dbc::parse(&common::chr_classes(StringBlock::Conventional)).unwrap();
    // As the real client has it: a token on every row, "DEMON" on the Warlock.
    assert_eq!(conventional.localised(0, F_PET_NAME, 0).unwrap(), "PET");
    assert_eq!(conventional.localised(8, F_PET_NAME, 0).unwrap(), "DEMON");

    // Without the leading NUL, "PET" is the string at offset zero — and a
    // string stored at offset zero is unreadable, because nothing in the file
    // distinguishes it from "no string". Reading the byte instead would make
    // every blank column in the table read as "PET".
    let repacked = Dbc::parse(&common::chr_classes(StringBlock::NoLeadingNul)).unwrap();
    assert_eq!(repacked.u32_field(0, F_PET_NAME).unwrap(), 0);
    assert_eq!(repacked.localised(0, F_PET_NAME, 0).unwrap(), "");
    // "DEMON" is at a real offset and still reads.
    assert_eq!(repacked.localised(8, F_PET_NAME, 0).unwrap(), "DEMON");

    // The name column is unaffected either way, which is the point.
    for table in [&conventional, &repacked] {
        assert_eq!(table.localised(0, F_NAME_LANG, 0).unwrap(), "Warrior");
        assert_eq!(table.localised(7, F_NAME_LANG, 0).unwrap(), "Mage");
    }
}

/// The fixture is the client, checked against what the client actually printed.
///
/// Every number here was read off a real 3.3.5a install on 2026-09-03. It is
/// the anchor that stops the fixture drifting back into agreeing with whatever
/// the code happens to believe.
#[test]
fn the_fixture_matches_the_measured_client() {
    let table = Dbc::parse(&common::chr_classes(StringBlock::Conventional)).unwrap();
    assert_eq!(table.record_count(), 10);
    assert_eq!(table.field_count, 60);
    assert_eq!(table.record_size, 240);

    // Three localised blocks, their flags words where the layout puts them.
    assert_eq!(table.u32_field(0, common::F_NAME_FLAGS).unwrap(), 16712191);
    assert_eq!(
        table.u32_field(0, common::F_NAME_FEMALE_FLAGS).unwrap(),
        16712172
    );
    assert_eq!(
        table.u32_field(0, common::F_NAME_MALE_FLAGS).unwrap(),
        16712172
    );

    // The decoy is fully populated — ten rows of plausible text, before the
    // name. This is what the old "first column holding text" search found.
    let rows = table.record_count();
    let pet = dbc::lang_candidates(&table, 0)
        .into_iter()
        .find(|c| c.field == F_PET_NAME)
        .expect("field 3 is a candidate");
    assert_eq!(pet.named, rows, "every row has a pet token, as measured");
    assert_eq!(pet.bleed, 10, "the name column falls inside its locales");
    assert!(!pet.is_clean(rows));

    // And the ten classes, in the client's order.
    let names: Vec<&str> = (0..rows)
        .map(|row| table.localised(row, F_NAME_LANG, 0).unwrap())
        .collect();
    assert_eq!(
        names,
        vec![
            "Warrior",
            "Paladin",
            "Hunter",
            "Rogue",
            "Priest",
            "Death Knight",
            "Shaman",
            "Mage",
            "Warlock",
            "Druid"
        ]
    );

    // CharBaseInfo, as the client printed it: 62 rows, 17 of the 30
    // race/body-type pairs present, no race with all three missing.
    let races = Dbc::parse(&common::char_base_info()).unwrap();
    let pairs = dbc::race_classes(&races).unwrap();
    assert_eq!(pairs.len(), 62);
    let present = [2u8, 3, 8]
        .iter()
        .flat_map(|class| {
            [1u8, 2, 3, 4, 5, 6, 7, 8, 10, 11]
                .iter()
                .map(move |race| (*race, *class))
        })
        .filter(|(race, class)| pairs.iter().any(|p| p.race == *race && p.class == *class))
        .count();
    assert_eq!(present, 17, "ADR 0010 section 10: 17 of 30 already exist");
}

/// The detector's own answer, without the tool around it — and the reason it
/// is trustworthy: the shape, not the presence of text.
#[test]
fn only_one_column_has_the_shape_of_a_lang_field() {
    for block in [StringBlock::Conventional, StringBlock::NoLeadingNul] {
        let table = Dbc::parse(&common::chr_classes(block)).unwrap();
        let rows = table.record_count();
        let clean: Vec<usize> = dbc::lang_candidates(&table, 0)
            .into_iter()
            .filter(|c| c.is_clean(rows))
            .map(|c| c.field)
            .collect();
        assert_eq!(clean, vec![F_NAME_LANG]);
        assert_eq!(dbc::find_name_field(&table, 0), Some(F_NAME_LANG));

        // The pet column is a candidate — it holds strings — and it loses on
        // bleed, because the name column falls inside its sixteen.
        let pet = dbc::lang_candidates(&table, 0)
            .into_iter()
            .find(|c| c.field == F_PET_NAME)
            .expect("field 3 should be considered");
        assert!(pet.bleed > 0, "the name column should bleed into field 3");
        assert!(!pet.is_clean(rows));
    }
}

/// The two ways this was actually got wrong on a real machine, both of which
/// printed the usage text and nothing else.
///
/// `inspect--dbc` is a typo the tool can resolve, and `D:\wow\TheraWoW wotlk`
/// unquoted is one path arriving as two arguments. Neither is worth a second
/// download, so both are handled — and the fake client here is named with a
/// space in it so the second one is exercised the way it happens.
#[test]
fn the_tool_survives_a_typo_and_an_unquoted_path() {
    let dir = tempfile::tempdir().unwrap();
    let client = dir.path().join("TheraWoW wotlk");
    std::fs::create_dir_all(&client).unwrap();
    fake_client(&client, StringBlock::Conventional);

    let split_path = dir.path().join("TheraWoW").to_string_lossy().into_owned();
    let output = Command::new(env!("CARGO_BIN_EXE_ashmorrow-manifest"))
        .args(["inspect--dbc", &split_path, "wotlk"])
        .output()
        .expect("the tool should run");
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();

    assert!(
        output.status.success(),
        "a typo and a missing pair of quotes should not cost a run\n\
         stdout:\n{text}\nstderr:\n{errors}"
    );
    assert!(
        errors.contains("reading 'inspect--dbc' as 'inspect-dbc'"),
        "it should say what it assumed:\n{errors}"
    );
    assert!(text.contains("race x class"), "no matrix:\n{text}");

    // A genuinely unknown command still fails, and says which word it choked on.
    let output = Command::new(env!("CARGO_BIN_EXE_ashmorrow-manifest"))
        .args(["inspekt", &client.to_string_lossy()])
        .output()
        .expect("the tool should run");
    assert!(!output.status.success());
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(errors.contains("unknown command 'inspekt'"), "{errors}");

    // And a locale the client does not have is named as such, rather than
    // failing later with something about MPQ archives.
    let output = Command::new(env!("CARGO_BIN_EXE_ashmorrow-manifest"))
        .args(["inspect-dbc", &client.to_string_lossy(), "frFR"])
        .output()
        .expect("the tool should run");
    assert!(!output.status.success());
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(
        errors.contains("not a locale this client has") && errors.contains("enUS"),
        "{errors}"
    );
}

/// The claim in ADR 0010 §3 that the whole race-data bill rests on: with
/// Paladin, Shaman and Mage as the three body types, only fourteen of the
/// thirty race/body-type pairs exist, and Night Elf gets none.
#[test]
fn the_stock_matrix_leaves_night_elf_with_nothing() {
    let table = Dbc::parse(&common::char_base_info()).unwrap();
    let rows = dbc::race_classes(&table).unwrap();
    assert_eq!(rows.len(), 62, "a 3.3.5a client has 62 rows, not 52");

    let races: Vec<u8> = vec![1, 2, 3, 4, 5, 6, 7, 8, 10, 11];
    let body_types: Vec<u8> = vec![2, 7, 8];

    let available = |race: u8| {
        body_types
            .iter()
            .filter(|class| rows.iter().any(|r| r.race == race && r.class == **class))
            .count()
    };

    let total: usize = races.iter().map(|race| available(*race)).sum();
    assert_eq!(
        total, 14,
        "ADR 0010 section 3 says fourteen of thirty exist"
    );
    assert_eq!(available(4), 0, "Night Elf is the race with no body type");
    assert_eq!(available(11), 3, "Draenei is the only race with all three");
}

/// The swap that was made, and the two it was made over. Kept as a test rather
/// than a table in prose because it is the whole justification for Skirmisher
/// being class 3, and a future edit to the chassis set should have to argue
/// with arithmetic. ADR 0010 section 10.
#[test]
fn hunter_is_the_only_chassis_triple_that_strands_no_race() {
    let table = Dbc::parse(&common::char_base_info()).unwrap();
    let rows = dbc::race_classes(&table).unwrap();
    let races: Vec<u8> = vec![1, 2, 3, 4, 5, 6, 7, 8, 10, 11];

    let count = |body_types: &[u8]| -> (usize, usize) {
        let per_race: Vec<usize> = races
            .iter()
            .map(|race| {
                body_types
                    .iter()
                    .filter(|class| rows.iter().any(|r| r.race == *race && r.class == **class))
                    .count()
            })
            .collect();
        (
            per_race.iter().sum(),
            per_race.iter().filter(|n| **n == 0).count(),
        )
    };

    // (pairs available out of thirty, races left with nothing)
    //
    // One plate chassis that also casts means Paladin — Warrior has rage and
    // Death Knight has runes — so the whole design space is
    // Paladin x {Shaman, Hunter} x {Mage, Priest, Warlock}. All six:
    assert_eq!(
        count(&[2, 7, 8]),
        (14, 1),
        "Shaman/Mage: Night Elf gets nothing"
    );
    assert_eq!(
        count(&[2, 7, 5]),
        (15, 1),
        "Shaman/Priest: Gnome gets nothing"
    );
    assert_eq!(
        count(&[2, 7, 9]),
        (13, 1),
        "Shaman/Warlock: Night Elf gets nothing"
    );
    assert_eq!(
        count(&[2, 3, 5]),
        (18, 1),
        "Hunter/Priest: best count, strands Gnome"
    );
    assert_eq!(
        count(&[2, 3, 9]),
        (16, 0),
        "Hunter/Warlock: no gaps, fewer pairs"
    );

    // Approved: Paladin / Hunter / Mage. Not the highest count — it leaves no
    // race without a body type, which is the property that matters, and of the
    // two that manage that it is the better.
    assert_eq!(count(&[2, 3, 8]), (17, 0));
}
