//! `inspect-dbc` against a client-shaped archive.
//!
//! The tool exists to read a *real* client, and this cannot be that: the
//! archive here is one we wrote, so it proves the reader agrees with our
//! writer rather than with Blizzard's. What it does prove is the whole path —
//! load order, archive, DBC header, string block, the name-column search and
//! the matrix — against a table laid out the way 3.3.5a lays `ChrClasses` out,
//! including the decoy string column that a naive search picks by mistake.

use std::path::Path;
use std::process::Command;

use launcher_core::dbc::{Dbc, LOCALES};
use launcher_core::mpq;

/// Field layout of `ChrClasses` in 3.3.5a, as far as the name.
const F_ID: usize = 0;
const F_PET_NAME: usize = 4;
const F_NAME_LANG: usize = 5;
const FIELDS: usize = F_NAME_LANG + LOCALES + 1 + 4;

fn chr_classes() -> Vec<u8> {
    let record_size = FIELDS * 4;
    let mut records: Vec<u8> = Vec::new();
    let mut strings: Vec<u8> = vec![0];

    let intern = |text: &str, strings: &mut Vec<u8>| -> u32 {
        if text.is_empty() {
            return 0;
        }
        let at = strings.len() as u32;
        strings.extend_from_slice(text.as_bytes());
        strings.push(0);
        at
    };

    // Ten classes, and only Hunter and Death Knight have a pet-name token —
    // which is the decoy: it is a string column too, and a search that stops at
    // "this looks like a string" would pick field 4 and rename the wrong thing.
    let classes: [(u32, &str, &str); 10] = [
        (1, "Warrior", ""),
        (2, "Paladin", ""),
        (3, "Hunter", "Pet"),
        (4, "Rogue", ""),
        (5, "Priest", ""),
        (6, "Death Knight", "Ghoul"),
        (7, "Shaman", ""),
        (8, "Mage", ""),
        (9, "Warlock", "Imp"),
        (11, "Druid", ""),
    ];

    for (id, name, pet) in classes {
        let name_at = intern(name, &mut strings);
        let pet_at = intern(pet, &mut strings);
        let mut record = vec![0u8; record_size];
        let put = |record: &mut Vec<u8>, field: usize, value: u32| {
            record[field * 4..field * 4 + 4].copy_from_slice(&value.to_le_bytes());
        };
        put(&mut record, F_ID, id);
        put(&mut record, F_PET_NAME, pet_at);
        // Only the installed locale's column is populated, as in a real client.
        put(&mut record, F_NAME_LANG, name_at);
        put(&mut record, F_NAME_LANG + LOCALES, 0xFF_FF_FF_FE);
        records.extend_from_slice(&record);
    }

    let mut out = b"WDBC".to_vec();
    out.extend_from_slice(&(classes.len() as u32).to_le_bytes());
    out.extend_from_slice(&(FIELDS as u32).to_le_bytes());
    out.extend_from_slice(&(record_size as u32).to_le_bytes());
    out.extend_from_slice(&(strings.len() as u32).to_le_bytes());
    out.extend_from_slice(&records);
    out.extend_from_slice(&strings);
    out
}

/// The Wrath matrix, as reasoned in ADR 0008 §3 — this is the thing a real
/// client is supposed to correct or confirm.
fn char_base_info() -> Vec<u8> {
    let pairs: &[(u8, u8)] = &[
        (1, 1),
        (1, 2),
        (1, 4),
        (1, 5),
        (1, 8),
        (1, 9), // Human
        (2, 1),
        (2, 3),
        (2, 4),
        (2, 7),
        (2, 9), // Orc
        (3, 1),
        (3, 2),
        (3, 3),
        (3, 4),
        (3, 5), // Dwarf
        (4, 1),
        (4, 3),
        (4, 4),
        (4, 5),
        (4, 11), // Night Elf
        (5, 1),
        (5, 4),
        (5, 5),
        (5, 8),
        (5, 9), // Undead
        (6, 1),
        (6, 3),
        (6, 7),
        (6, 11), // Tauren
        (7, 1),
        (7, 4),
        (7, 8),
        (7, 9), // Gnome
        (8, 1),
        (8, 3),
        (8, 4),
        (8, 5),
        (8, 7),
        (8, 8), // Troll
        (10, 2),
        (10, 3),
        (10, 4),
        (10, 5),
        (10, 8),
        (10, 9), // Blood Elf
        (11, 1),
        (11, 2),
        (11, 3),
        (11, 5),
        (11, 7),
        (11, 8), // Draenei
    ];
    let mut records = Vec::new();
    for (race, class) in pairs {
        records.push(*race);
        records.push(*class);
    }
    let mut out = b"WDBC".to_vec();
    out.extend_from_slice(&(pairs.len() as u32).to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&records);
    out.push(0);
    out
}

fn fake_client(root: &Path) {
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
        let mut table = Dbc::parse(&chr_classes()).unwrap();
        table.set_localised(0, F_NAME_LANG, "Stale").unwrap();
        table.write()
    };
    std::fs::write(
        locale.join("locale-enUS.MPQ"),
        mpq::write(&[
            (launcher_core::dbc::CHR_CLASSES.to_string(), stale),
            (
                launcher_core::dbc::CHAR_BASE_INFO.to_string(),
                char_base_info(),
            ),
        ])
        .unwrap(),
    )
    .unwrap();
    std::fs::write(
        locale.join("patch-enUS-3.MPQ"),
        mpq::write(&[(launcher_core::dbc::CHR_CLASSES.to_string(), chr_classes())]).unwrap(),
    )
    .unwrap();
}

#[test]
fn inspect_dbc_reads_a_clients_tables_and_reports_the_matrix() {
    let dir = tempfile::tempdir().unwrap();
    fake_client(dir.path());

    let output = Command::new(env!("CARGO_BIN_EXE_ashmorrow-manifest"))
        .args(["inspect-dbc", &dir.path().to_string_lossy()])
        .output()
        .expect("the tool should run");
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(
        output.status.success(),
        "inspect-dbc failed\nstdout:\n{text}\nstderr:\n{errors}"
    );

    // `SHOW=1 cargo test --test inspect_dbc -- --nocapture` prints the report,
    // which is the quickest way to see what a real client will produce.
    if std::env::var_os("SHOW").is_some() {
        println!("{text}");
    }

    // It found the name column, and not the pet-name decoy at field 4.
    assert!(
        text.contains(&format!("Name_Lang looks like field {F_NAME_LANG}")),
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

/// The claim in ADR 0008 §3 that the whole race-data bill rests on: with
/// Paladin, Shaman and Mage as the three body types, only fourteen of the
/// thirty race/body-type pairs exist, and Night Elf gets none.
#[test]
fn the_stock_matrix_leaves_night_elf_with_nothing() {
    let table = Dbc::parse(&char_base_info()).unwrap();
    let rows = launcher_core::dbc::race_classes(&table).unwrap();

    let races: Vec<u8> = vec![1, 2, 3, 4, 5, 6, 7, 8, 10, 11];
    let body_types: Vec<u8> = vec![2, 7, 8];

    let available = |race: u8| {
        body_types
            .iter()
            .filter(|class| rows.iter().any(|r| r.race == race && r.class == **class))
            .count()
    };

    let total: usize = races.iter().map(|race| available(*race)).sum();
    assert_eq!(total, 14, "ADR 0008 §3 says fourteen of thirty exist");
    assert_eq!(available(4), 0, "Night Elf is the race with no body type");
    assert_eq!(available(11), 3, "Draenei is the only race with all three");
}

/// And the swap this project is being asked to decide on: Hunter in place of
/// Shaman fixes the empty screen and cuts the bill.
#[test]
fn swapping_shaman_for_hunter_gives_every_race_something() {
    let table = Dbc::parse(&char_base_info()).unwrap();
    let rows = launcher_core::dbc::race_classes(&table).unwrap();
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

    // Paladin(2) / Shaman(7) / Mage(8) — what BODY-TYPES.md approved.
    assert_eq!(count(&[2, 7, 8]), (14, 1));
    // Paladin(2) / Hunter(3) / Mage(8) — the proposed swap.
    assert_eq!(count(&[2, 3, 8]), (17, 0));
    // Paladin(2) / Hunter(3) / Priest(5) — better on count, worse on coverage:
    // it strands Gnome, which has no Priest in Wrath.
    assert_eq!(count(&[2, 3, 5]), (18, 1));
}
