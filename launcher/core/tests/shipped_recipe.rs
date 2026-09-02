//! The recipe we ship has to load, and mean what ADR 0008 says it means.
//!
//! It is a hand-edited JSON file that nothing parses at build time, and it
//! describes edits to a player's game directory. That combination is worth a
//! test on its own: a recipe that parses but says the wrong thing produces a
//! character creation screen with blank names on it, on someone else's machine.

use std::path::PathBuf;

use launcher_core::dbc::{self, Dbc, LOCALES};
use launcher_core::recipe::{self, Recipe};

fn launcher() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("launcher/core has a parent")
        .to_path_buf()
}

fn shipped() -> Recipe {
    let path = launcher().join("recipes/body-types.json");
    let bytes = std::fs::read(&path).expect("launcher/recipes/body-types.json is missing");
    Recipe::parse(&bytes).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn the_shipped_recipe_parses() {
    let recipe = shipped();
    assert_eq!(recipe.id, "body-types");
    assert!(recipe.version >= 1);
    assert_eq!(recipe.output, "Data/patch-4.MPQ");
}

/// The three body types, and only those three. If BODY-TYPES.md and this file
/// ever disagree about which classes are the chassis, the character creation
/// screen believes this one.
#[test]
fn the_recipe_renames_exactly_the_three_body_types() {
    let recipe = shipped();
    let mut renamed: Vec<(u32, String)> = recipe
        .chr_classes
        .rename
        .iter()
        .map(|r| (r.class, r.to.clone()))
        .collect();
    renamed.sort();
    assert_eq!(
        renamed,
        vec![
            (2, "Vanguard".to_string()),
            (7, "Skirmisher".to_string()),
            (8, "Adept".to_string()),
        ]
    );

    let mut keep = recipe.char_base_info.keep_classes.clone();
    keep.sort_unstable();
    assert_eq!(
        keep,
        vec![2, 7, 8],
        "the classes kept must be the classes renamed, or the screen shows a \
         body type with no rows or a row with a stock name"
    );
}

/// ADR 0008 §3 and §10: sixteen pairs are missing, Night Elf needs all three.
#[test]
fn the_recipe_adds_the_sixteen_missing_pairs() {
    let recipe = shipped();
    let add = &recipe.char_base_info.add;
    assert_eq!(add.len(), 16, "ADR 0008 §10.1 confirmed sixteen");

    let mut seen: Vec<(u8, u8)> = add.iter().map(|r| (r.race, r.class)).collect();
    seen.sort_unstable();
    let mut unique = seen.clone();
    unique.dedup();
    assert_eq!(seen, unique, "a pair is listed twice");

    for row in add {
        assert!(
            recipe.char_base_info.keep_classes.contains(&row.class),
            "race {} is given class {}, which is not a body type",
            row.race,
            row.class
        );
    }

    let night_elf: Vec<u8> = add
        .iter()
        .filter(|r| r.race == 4)
        .map(|r| r.class)
        .collect();
    assert_eq!(
        night_elf.len(),
        3,
        "Night Elf has no body type at all in a stock client, so it needs all three"
    );
}

/// A recipe is instructions, and the point of instructions is that they are not
/// bytes of anyone else's file. Nothing in it may name a place to fetch one.
#[test]
fn the_recipe_names_no_place_to_obtain_anything() {
    let text = std::fs::read_to_string(launcher().join("recipes/body-types.json")).unwrap();
    for forbidden in ["http://", "https://", "magnet:"] {
        assert!(
            !text.contains(forbidden),
            "the recipe carries a {forbidden} locator; it is edits, not a download \
             (ADR 0005 rules 1 and 2)"
        );
    }
}

/// Nothing is published until the server accepts the combinations it offers.
/// This test is the reminder, and it is expected to be edited — deliberately —
/// in the pull request that publishes the recipe.
#[test]
fn the_recipe_is_not_published_yet() {
    let text = std::fs::read_to_string(launcher().join("patch-manifest.json")).unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
    let recipes = manifest["recipes"].as_array().expect("a recipes array");
    assert!(
        recipes.is_empty(),
        "a recipe is listed in patch-manifest.json. That is the step that makes \
         launchers apply it, and ADR 0009 §6 puts it after the server-side race \
         data lands. If that has happened, delete this test in the same PR."
    );
}

/// End to end against a client-shaped table: the shipped recipe applied to
/// stock tables gives a screen with three names on it and no stock class left.
#[test]
fn applying_the_shipped_recipe_leaves_three_named_body_types() {
    let recipe = shipped();

    // `ChrClasses` laid out as 3.3.5a lays it out, so the shipped
    // `name_field` is exercised rather than a convenient stand-in.
    let fields = recipe.chr_classes.name_field + LOCALES + 1 + 4;
    let record_size = fields * 4;
    let stock: [(u32, &str); 10] = [
        (1, "Warrior"),
        (2, "Paladin"),
        (3, "Hunter"),
        (4, "Rogue"),
        (5, "Priest"),
        (6, "Death Knight"),
        (7, "Shaman"),
        (8, "Mage"),
        (9, "Warlock"),
        (11, "Druid"),
    ];
    let mut records: Vec<u8> = Vec::new();
    let mut strings: Vec<u8> = vec![0];
    for (id, name) in stock {
        let at = strings.len() as u32;
        strings.extend_from_slice(name.as_bytes());
        strings.push(0);
        let mut record = vec![0u8; record_size];
        record[..4].copy_from_slice(&id.to_le_bytes());
        let name_at = recipe.chr_classes.name_field * 4;
        record[name_at..name_at + 4].copy_from_slice(&at.to_le_bytes());
        records.extend_from_slice(&record);
    }
    let mut classes_bytes = b"WDBC".to_vec();
    classes_bytes.extend_from_slice(&(stock.len() as u32).to_le_bytes());
    classes_bytes.extend_from_slice(&(fields as u32).to_le_bytes());
    classes_bytes.extend_from_slice(&(record_size as u32).to_le_bytes());
    classes_bytes.extend_from_slice(&(strings.len() as u32).to_le_bytes());
    classes_bytes.extend_from_slice(&records);
    classes_bytes.extend_from_slice(&strings);
    let classes = Dbc::parse(&classes_bytes).unwrap();

    // The stock matrix, as a real client has it.
    let stock_pairs: &[(u8, u8)] = &[
        (1, 1),
        (1, 2),
        (1, 4),
        (1, 5),
        (1, 8),
        (1, 9),
        (2, 1),
        (2, 3),
        (2, 4),
        (2, 7),
        (2, 9),
        (3, 1),
        (3, 2),
        (3, 3),
        (3, 4),
        (3, 5),
        (4, 1),
        (4, 3),
        (4, 4),
        (4, 5),
        (4, 11),
        (5, 1),
        (5, 4),
        (5, 5),
        (5, 8),
        (5, 9),
        (6, 1),
        (6, 3),
        (6, 7),
        (6, 11),
        (7, 1),
        (7, 4),
        (7, 8),
        (7, 9),
        (8, 1),
        (8, 3),
        (8, 4),
        (8, 5),
        (8, 7),
        (8, 8),
        (10, 2),
        (10, 3),
        (10, 4),
        (10, 5),
        (10, 8),
        (10, 9),
        (11, 1),
        (11, 2),
        (11, 3),
        (11, 5),
        (11, 7),
        (11, 8),
    ];
    let mut race_bytes = b"WDBC".to_vec();
    race_bytes.extend_from_slice(&(stock_pairs.len() as u32).to_le_bytes());
    race_bytes.extend_from_slice(&2u32.to_le_bytes());
    race_bytes.extend_from_slice(&2u32.to_le_bytes());
    race_bytes.extend_from_slice(&1u32.to_le_bytes());
    for (race, class) in stock_pairs {
        race_bytes.push(*race);
        race_bytes.push(*class);
    }
    race_bytes.push(0);
    let races = Dbc::parse(&race_bytes).unwrap();

    let (classes, races) = recipe::apply(&recipe, &classes, &races).expect("the shipped recipe");

    // Every class the player can pick is renamed, and no stock name survives on
    // one of them.
    let rows = dbc::race_classes(&races).unwrap();
    for row in &rows {
        let index = (0..classes.record_count())
            .find(|&i| classes.u32_field(i, 0).unwrap() == row.class as u32)
            .expect("a selectable class must exist in ChrClasses");
        let name = classes
            .localised(index, recipe.chr_classes.name_field, 0)
            .unwrap();
        assert!(
            ["Vanguard", "Skirmisher", "Adept"].contains(&name),
            "race {} can pick class {}, which is still called {name}",
            row.race,
            row.class
        );
    }

    // And every race can pick something.
    let mut races_present: Vec<u8> = rows.iter().map(|r| r.race).collect();
    races_present.sort_unstable();
    races_present.dedup();
    assert_eq!(
        races_present,
        vec![1, 2, 3, 4, 5, 6, 7, 8, 10, 11],
        "a race with no row gets an empty character creation screen"
    );

    // Thirty pairs: ten races times three body types, which is the whole point.
    assert_eq!(rows.len(), 30);
}
