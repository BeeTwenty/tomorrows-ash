// Each integration test binary compiles this module separately, so items
// only one of them uses are "dead" in the others.
#![allow(dead_code)]

//! Client-shaped tables to test against.
//!
//! These are not convenient stand-ins. They are the 3.3.5a layout as the core's
//! own loader parses it, because a fixture that encodes the same belief as the
//! code proves only that the two agree.
//!
//! That is not hypothetical. The first version of this fixture put `ChrClasses`
//! at 26 fields with the name at 5 — the same off-by-one the recipe carried —
//! so every test passed while the shipped recipe pointed one column past the
//! name. A real client has 60 fields and the name at 4, and said so the first
//! time anyone ran the tool against one.
//!
//! The layout below is `ChrClassesEntryfmt` from the pinned upstream
//! (`src/server/shared/DataStores/DBCfmt.h`):
//!
//! ```text
//! "nxixssssssssssssssssxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxixii"   60 fields
//!   0    ClassID          20      Name_Lang flags
//!   1    unused           21..36  Name_Female_Lang
//!   2    powerType        37      its flags
//!   3    PetNameToken     38..53  Name_Male_Lang
//!   4..19  Name_Lang      54      its flags
//!                         55      Filename
//!                         56, 57, 58, 59
//! ```

use launcher_core::dbc::LOCALES;

pub const F_ID: usize = 0;
pub const F_POWER: usize = 2;
/// The decoy: a plain string column that comes *before* the name.
pub const F_PET_NAME: usize = 3;
/// The name, as the core's format string places it.
pub const F_NAME_LANG: usize = 4;
pub const F_NAME_FLAGS: usize = F_NAME_LANG + LOCALES;
pub const F_FILENAME: usize = 55;
pub const FIELDS: usize = 60;

/// The value 3.3.5a writes in `Name_Lang`'s flags column, as measured on a real
/// client. The two name blocks that follow carry a different one.
pub const STRING_FLAGS: u32 = 16712191;
pub const STRING_FLAGS_OTHER: u32 = 16712172;
pub const F_NAME_FEMALE_FLAGS: usize = 37;
pub const F_NAME_MALE_FLAGS: usize = 54;

/// How the string block begins.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StringBlock {
    /// A leading NUL, so offset zero means "no string". Every Blizzard file.
    Conventional,
    /// No leading NUL, so offset zero is the first real string. Produced by
    /// some third-party DBC editors, and the reason a column of empty pet
    /// tokens can print as a column of names.
    NoLeadingNul,
}

/// `ChrClasses` as a 3.3.5a client has it.
///
/// Only the enUS locale column is populated, which is what an enUS install
/// looks like and what makes the fifteen empty columns a usable signal.
pub fn chr_classes(block: StringBlock) -> Vec<u8> {
    let record_size = FIELDS * 4;

    // (id, name, pet name token), as measured on a real 3.3.5a client.
    //
    // Every class carries a pet token, not just the two that have pets — nine
    // "PET" and Warlock's "DEMON". That is what made field 3 a perfect decoy:
    // ten rows of plausible text, in a column that comes before the name.
    let classes: [(u32, &str, &str); 10] = [
        (1, "Warrior", "PET"),
        (2, "Paladin", "PET"),
        (3, "Hunter", "PET"),
        (4, "Rogue", "PET"),
        (5, "Priest", "PET"),
        (6, "Death Knight", "PET"),
        (7, "Shaman", "PET"),
        (8, "Mage", "PET"),
        (9, "Warlock", "DEMON"),
        (11, "Druid", "PET"),
    ];

    let mut strings: Vec<u8> = match block {
        StringBlock::Conventional => vec![0],
        // No leading NUL, so offset zero is a real string and every empty
        // reference reads as it. Not what the measured client does — it has
        // the NUL — but a shape a repacked table can have, and the reader must
        // not depend on the byte.
        StringBlock::NoLeadingNul => Vec::new(),
    };
    let intern = |text: &str, strings: &mut Vec<u8>| -> u32 {
        if text.is_empty() {
            return 0;
        }
        let mut at = 0usize;
        while at < strings.len() {
            let end = strings[at..]
                .iter()
                .position(|&b| b == 0)
                .map(|n| at + n)
                .unwrap_or(strings.len());
            if &strings[at..end] == text.as_bytes() {
                return at as u32;
            }
            at = end + 1;
        }
        let offset = strings.len() as u32;
        strings.extend_from_slice(text.as_bytes());
        strings.push(0);
        offset
    };

    let mut records: Vec<u8> = Vec::new();
    for (id, name, pet) in classes {
        let mut record = vec![0u8; record_size];
        let mut put = |field: usize, value: u32| {
            record[field * 4..field * 4 + 4].copy_from_slice(&value.to_le_bytes());
        };
        put(F_ID, id);
        put(F_POWER, if id == 1 { 1 } else { 0 });
        put(F_PET_NAME, intern(pet, &mut strings));
        // Only the locale the client is installed in.
        put(F_NAME_LANG, intern(name, &mut strings));
        put(F_NAME_FLAGS, STRING_FLAGS);
        put(F_NAME_FEMALE_FLAGS, STRING_FLAGS_OTHER);
        put(F_NAME_MALE_FLAGS, STRING_FLAGS_OTHER);
        // The client stores the name again in upper case as the filename.
        put(F_FILENAME, intern(&name.to_uppercase(), &mut strings));
        put(56, 0);
        put(58, 0);
        put(59, 0);
        records.extend_from_slice(&record);
    }

    dbc_bytes(10, FIELDS as u32, record_size as u32, &records, &strings)
}

/// `CharBaseInfo` as a 3.3.5a client has it: 62 rows of two bytes.
///
/// Death Knight rows included, because the client has them — the table is 62
/// rows, not the 52 a list written from memory produces.
pub fn char_base_info() -> Vec<u8> {
    let mut pairs: Vec<(u8, u8)> = Vec::new();
    let stock: [(u8, &[u8]); 10] = [
        (1, &[1, 2, 4, 5, 8, 9]),
        (2, &[1, 3, 4, 7, 9]),
        (3, &[1, 2, 3, 4, 5]),
        (4, &[1, 3, 4, 5, 11]),
        (5, &[1, 4, 5, 8, 9]),
        (6, &[1, 3, 7, 11]),
        (7, &[1, 4, 8, 9]),
        (8, &[1, 3, 4, 5, 7, 8]),
        (10, &[2, 3, 4, 5, 8, 9]),
        (11, &[1, 2, 3, 5, 7, 8]),
    ];
    for (race, classes) in stock {
        for class in classes {
            pairs.push((race, *class));
        }
        // Wrath gave every race the Death Knight.
        pairs.push((race, 6));
    }

    let mut records = Vec::new();
    for (race, class) in &pairs {
        records.push(*race);
        records.push(*class);
    }
    dbc_bytes(pairs.len() as u32, 2, 2, &records, &[0])
}

fn dbc_bytes(rows: u32, fields: u32, record_size: u32, records: &[u8], strings: &[u8]) -> Vec<u8> {
    let mut out = b"WDBC".to_vec();
    out.extend_from_slice(&rows.to_le_bytes());
    out.extend_from_slice(&fields.to_le_bytes());
    out.extend_from_slice(&record_size.to_le_bytes());
    out.extend_from_slice(&(strings.len() as u32).to_le_bytes());
    out.extend_from_slice(records);
    out.extend_from_slice(strings);
    out
}

/// A client on disk: `Wow.exe` with a real version resource, and the two tables
/// in a real archive under the locale directory.
///
/// The same shape the tool and the launcher both expect, so a test that drives
/// either of them is driving the real path rather than a stub.
pub fn write_client(root: &std::path::Path, block: StringBlock) {
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

    std::fs::write(
        locale.join("locale-enUS.MPQ"),
        launcher_core::mpq::write(&[
            (
                launcher_core::dbc::CHR_CLASSES.to_string(),
                chr_classes(block),
            ),
            (
                launcher_core::dbc::CHAR_BASE_INFO.to_string(),
                char_base_info(),
            ),
        ])
        .unwrap(),
    )
    .unwrap();
}
