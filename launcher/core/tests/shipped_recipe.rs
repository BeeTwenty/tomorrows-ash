//! The recipe we ship has to load, and mean what ADR 0010 says it means.
//!
//! It is a hand-edited JSON file that nothing parses at build time, and it
//! describes edits to a player's game directory. That combination is worth a
//! test on its own: a recipe that parses but says the wrong thing produces a
//! character creation screen with blank names on it, on someone else's machine.

mod common;

use std::path::PathBuf;

use common::StringBlock;
use launcher_core::dbc::{self, Dbc};
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
///
/// Skirmisher is Hunter (3), not Shaman (7) — ADR 0010 §10. Changing that back
/// without also changing `add` would strand Night Elf again, which is the whole
/// reason the swap happened.
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
            (3, "Skirmisher".to_string()),
            (8, "Adept".to_string()),
        ]
    );

    let mut keep = recipe.char_base_info.keep_classes.clone();
    keep.sort_unstable();
    assert_eq!(
        keep,
        vec![2, 3, 8],
        "the classes kept must be the classes renamed, or the screen shows a \
         body type with no rows or a row with a stock name"
    );
}

/// ADR 0010 §10: with Hunter as Skirmisher, thirteen pairs are missing rather
/// than sixteen, and no race is left without one.
#[test]
fn the_recipe_adds_the_thirteen_missing_pairs() {
    let recipe = shipped();
    let add = &recipe.char_base_info.add;
    assert_eq!(
        add.len(),
        13,
        "Paladin/Hunter/Mage leaves thirteen gaps, not sixteen"
    );

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

    // Night Elf is the race the swap was made for: it has Hunter natively, so
    // it now needs only the other two rather than all three.
    let mut night_elf: Vec<u8> = add
        .iter()
        .filter(|r| r.race == 4)
        .map(|r| r.class)
        .collect();
    night_elf.sort_unstable();
    assert_eq!(night_elf, vec![2, 8]);

    // Blood Elf and Draenei reach all three in a stock client, so a row for
    // either is a row that does nothing.
    for race in [10u8, 11] {
        assert!(
            !add.iter().any(|r| r.race == race),
            "race {race} already has every body type"
        );
    }
}

/// The recipe and the design document have to name the same three classes.
///
/// They are edited by different people for different reasons — one is balance,
/// the other is a character-creation screen — and this swap is exactly the
/// change that moves both. A divergence here shows up as a body type wearing
/// the wrong armour, which is a slow and confusing bug to find from play.
#[test]
fn the_recipe_agrees_with_body_types_about_which_classes_the_chassis_are() {
    let doc = launcher()
        .parent()
        .expect("the repository root")
        .join("docs/BODY-TYPES.md");
    let text = std::fs::read_to_string(&doc).expect("docs/BODY-TYPES.md is missing");
    let row = text
        .lines()
        .find(|line| line.starts_with("| Underlying class"))
        .expect("BODY-TYPES.md has an 'Underlying class' row");

    // "| Underlying class | Paladin (2) | **Hunter (3)** | Mage (8) |"
    let mut documented: Vec<u8> = row
        .split('(')
        .skip(1)
        .filter_map(|rest| rest.split(')').next())
        .filter_map(|id| id.trim().parse::<u8>().ok())
        .collect();
    documented.sort_unstable();
    assert_eq!(documented.len(), 3, "expected three chassis in {row:?}");

    let mut keep = shipped().char_base_info.keep_classes.clone();
    keep.sort_unstable();
    assert_eq!(
        keep, documented,
        "the recipe keeps classes {keep:?} but BODY-TYPES.md says the body types \
         are {documented:?}"
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

/// The recipe's `name_field` has to be the column a real client keeps names in.
///
/// This is the test that was missing. The old one built its own `ChrClasses`
/// *from* `recipe.name_field`, so the fixture moved whenever the recipe did and
/// the pair agreed with each other all the way to a real client, where the
/// recipe was one column late. The fixture is now the layout the core's loader
/// parses, fixed independently of the recipe, and the recipe is checked against
/// it.
#[test]
fn the_recipe_points_at_the_column_a_real_client_keeps_names_in() {
    let recipe = shipped();
    let table = Dbc::parse(&common::chr_classes(StringBlock::Conventional)).unwrap();

    assert_eq!(
        dbc::find_name_field(&table, recipe.chr_classes.id_field),
        Some(recipe.chr_classes.name_field),
        "the recipe's name_field is not the column a 3.3.5a client keeps class \
         names in (ChrClassesEntryfmt: id 0, powerType 2, PetNameToken 3, \
         Name_Lang 4..19)"
    );

    // And the id column really is the ids, not something that merely sorts.
    let ids: Vec<u32> = (0..table.record_count())
        .map(|row| table.u32_field(row, recipe.chr_classes.id_field).unwrap())
        .collect();
    assert_eq!(ids, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
}

/// Applying it leaves the flags word alone.
///
/// `set_localised` writes sixteen columns from `name_field`. One column late
/// and the sixteenth lands on the string-flags word that follows the block —
/// so the symptom of the off-by-one was not "the wrong name" but "the right
/// name, invisible, and a corrupted table". Worth its own assertion.
#[test]
fn applying_the_recipe_does_not_touch_the_string_flags_word() {
    let recipe = shipped();
    let before = Dbc::parse(&common::chr_classes(StringBlock::Conventional)).unwrap();
    let races = Dbc::parse(&common::char_base_info()).unwrap();
    let (after, _) = recipe::apply(&recipe, &before, &races).expect("the shipped recipe");

    let flags = recipe.chr_classes.name_field + launcher_core::dbc::LOCALES;
    for row in 0..after.record_count() {
        assert_eq!(
            after.u32_field(row, flags).unwrap(),
            common::STRING_FLAGS,
            "row {row}'s string-flags word was overwritten — name_field is one \
             column past where it should be"
        );
    }
}

/// End to end against a client-shaped table: the shipped recipe applied to
/// stock tables gives a screen with three names on it and no stock class left.
#[test]
fn applying_the_shipped_recipe_leaves_three_named_body_types() {
    let recipe = shipped();
    let classes = Dbc::parse(&common::chr_classes(StringBlock::Conventional)).unwrap();
    let races = Dbc::parse(&common::char_base_info()).unwrap();

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

/// The apply-time cross-check refuses a recipe that does not fit the client.
///
/// The self-test for the guard above: with `name_field` moved one column, the
/// per-row plausibility check still passes — fifteen of the sixteen locale
/// columns overlap the real block — so this is the only thing standing between
/// an off-by-one and a corrupted table on somebody's disk.
#[test]
fn a_recipe_pointing_at_the_wrong_column_is_refused() {
    let mut recipe = shipped();
    let classes = Dbc::parse(&common::chr_classes(StringBlock::Conventional)).unwrap();
    let races = Dbc::parse(&common::char_base_info()).unwrap();

    // It applies as shipped.
    recipe::apply(&recipe, &classes, &races).expect("the shipped recipe fits a stock client");

    // One column late — the exact mistake — and it must not.
    recipe.chr_classes.name_field += 1;
    let error = recipe::apply(&recipe, &classes, &races)
        .expect_err("a recipe one column late must be refused, not applied");
    let text = error.to_string();
    assert!(
        text.contains("column 5") && text.contains("column 4"),
        "the refusal should name both columns: {text}"
    );

    // And one column early, which corrupts in the other direction.
    recipe.chr_classes.name_field -= 2;
    recipe::apply(&recipe, &classes, &races)
        .expect_err("a recipe one column early must be refused too");
}
