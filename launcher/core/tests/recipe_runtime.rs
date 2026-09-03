//! Building a recipe against a client on disk, and deciding when to do it again.
//!
//! The pure half of `recipe` is tested against tables built in memory. This is
//! the other half: real archives, a real file written into a real directory,
//! and the five triggers of ADR 0009 §4 driven one at a time.

mod common;

use std::path::Path;

use common::StringBlock;
use launcher_core::ledger::{self, Entry, Ledger, Need};
use launcher_core::recipe::{self, Recipe};

fn shipped() -> Recipe {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("recipes/body-types.json");
    Recipe::parse(&std::fs::read(&path).unwrap()).unwrap()
}

fn client(dir: &tempfile::TempDir) -> &Path {
    let root = dir.path();
    common::write_client(root, StringBlock::Conventional);
    root
}

/// The claim Tier 3b rests on, stated as a test because the ledger's whole
/// design is "compare hashes instead of rebuilding", and that is only sound if
/// a rebuild would produce the same bytes.
///
/// ADR 0009 §5. If this fails, `ledger::need` is checking something that does
/// not mean what it says.
#[test]
fn rebuilding_is_deterministic() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let recipe = shipped();

    let (first, first_built) = recipe::build(&recipe, root, "enUS").unwrap();
    let (second, second_built) = recipe::build(&recipe, root, "enUS").unwrap();

    assert_eq!(
        first, second,
        "the same recipe and client gave different bytes"
    );
    assert_eq!(first_built.hash, second_built.hash);
    assert_eq!(first_built.sources, second_built.sources);
    assert_eq!(
        first_built.hash,
        blake3::hash(&first).to_hex().to_string(),
        "the recorded hash must be the hash of what was written"
    );
}

/// What a build actually produced, read back out of the archive it wrote.
#[test]
fn a_built_archive_holds_the_edited_tables() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let recipe = shipped();

    let (bytes, built) = recipe::build(&recipe, root, "enUS").unwrap();
    let output = recipe.output_path(root, "enUS");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, &bytes).unwrap();

    assert_eq!(built.recipe_id, "body-types");
    assert_eq!(built.race_classes, 30, "ten races times three body types");
    assert_eq!(built.sources.len(), 2);

    // The archive the game would load last is ours, and reading the tables
    // back out of it gives the patched screen.
    let order = launcher_core::mpq::load_order(root, "enUS");
    assert_eq!(
        order.last().unwrap(),
        &output,
        "the built archive must win the load order, or the patch does nothing. \
         A base-slot Data/patch-N.MPQ loads BEFORE every locale archive, and a real \
         client keeps ChrClasses.dbc in Data/<locale>/patch-<locale>-N.MPQ — so a \
         base-slot patch is shadowed by the client's own and changes nothing. \
         ADR 0010 §7.3. Order was: {order:?}"
    );

    let classes = launcher_core::dbc::Dbc::parse(
        &launcher_core::mpq::read_effective(&order, launcher_core::dbc::CHR_CLASSES)
            .unwrap()
            .bytes,
    )
    .unwrap();
    let races = launcher_core::dbc::Dbc::parse(
        &launcher_core::mpq::read_effective(&order, launcher_core::dbc::CHAR_BASE_INFO)
            .unwrap()
            .bytes,
    )
    .unwrap();

    let rows = launcher_core::dbc::race_classes(&races).unwrap();
    assert_eq!(rows.len(), 30);
    for row in &rows {
        let index = (0..classes.record_count())
            .find(|&i| classes.u32_field(i, 0).unwrap() == row.class as u32)
            .unwrap();
        let name = classes
            .localised(index, recipe.chr_classes.name_field, 0)
            .unwrap();
        assert!(
            ["Vanguard", "Skirmisher", "Adept"].contains(&name),
            "race {} can pick {name}",
            row.race
        );
    }
}

/// The five triggers of ADR 0009 §4, each provoked on purpose.
#[test]
fn every_rebuild_trigger_fires_for_its_own_reason() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let recipe = shipped();

    // 1. Nothing built, nothing in the slot.
    assert_eq!(
        ledger::need(&recipe, None, root, "enUS").unwrap(),
        Need::NeverBuilt
    );

    let (bytes, built) = recipe::build(&recipe, root, "enUS").unwrap();
    let output = recipe.output_path(root, "enUS");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, &bytes).unwrap();

    let mut entry = Entry {
        client_root: root.to_path_buf(),
        output: recipe.output_for("enUS"),
        built: built.clone(),
    };

    // 0. The happy path, which everything below is a departure from.
    assert_eq!(
        ledger::need(&recipe, Some(&entry), root, "enUS").unwrap(),
        Need::UpToDate
    );

    // 2. A newer recipe.
    let mut newer = recipe.clone();
    newer.version += 1;
    assert_eq!(
        ledger::need(&newer, Some(&entry), root, "enUS").unwrap(),
        Need::NewVersion {
            have: recipe.version,
            published: recipe.version + 1
        }
    );

    // 3. The archive is gone.
    std::fs::remove_file(&output).unwrap();
    assert_eq!(
        ledger::need(&recipe, Some(&entry), root, "enUS").unwrap(),
        Need::ArchiveMissing {
            path: recipe.output_for("enUS")
        }
    );

    // 4. The archive is there and is not ours.
    std::fs::write(&output, b"another server's patch").unwrap();
    assert_eq!(
        ledger::need(&recipe, Some(&entry), root, "enUS").unwrap(),
        Need::ArchiveChanged {
            path: recipe.output_for("enUS")
        }
    );
    std::fs::write(&output, &bytes).unwrap();
    assert_eq!(
        ledger::need(&recipe, Some(&entry), root, "enUS").unwrap(),
        Need::UpToDate
    );

    // 5. The player's own tables changed under it — a repair, a repack, a
    //    reinstall. The one that is easy to forget and worst to get wrong.
    entry.built.sources[0].hash = "0".repeat(64);
    let need = ledger::need(&recipe, Some(&entry), root, "enUS").unwrap();
    assert!(
        matches!(need, Need::SourceChanged { ref table } if table.ends_with(".dbc")),
        "expected a source-changed verdict, got {need:?}"
    );
}

/// The slot is a convention, so somebody else's archive can already be in it.
/// ADR 0010 §7: stop, do not overwrite.
#[test]
fn an_unknown_archive_in_the_slot_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let recipe = shipped();

    let output = recipe.output_path(root, "enUS");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, b"some other server's patch-4").unwrap();

    let need = ledger::need(&recipe, None, root, "enUS").unwrap();
    assert_eq!(
        need,
        Need::NotOurs {
            path: recipe.output_for("enUS")
        }
    );
    assert!(
        !need.can_build(),
        "building would destroy a file we did not write"
    );
    assert!(!need.is_up_to_date(), "and it is certainly not up to date");

    // The bytes are still theirs.
    assert_eq!(
        std::fs::read(&output).unwrap(),
        b"some other server's patch-4"
    );
}

/// A ledger survives a round trip through the file it is stored in.
#[test]
fn the_ledger_persists() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let recipe = shipped();
    let (_, built) = recipe::build(&recipe, root, "enUS").unwrap();

    let path = dir.path().join("state/recipes.json");
    let mut ledger = Ledger::default();
    ledger.record(Entry {
        client_root: root.to_path_buf(),
        output: recipe.output_for("enUS"),
        built,
    });
    ledger.save(&path).unwrap();

    assert_eq!(Ledger::load(&path), ledger);
    // A ledger that is not there, or is rubbish, is an empty ledger rather
    // than a launcher that will not start.
    assert_eq!(
        Ledger::load(&dir.path().join("nope.json")),
        Ledger::default()
    );
    std::fs::write(&path, b"{ not json").unwrap();
    assert_eq!(Ledger::load(&path), Ledger::default());
}

/// A rebuild must read the player's tables, not the ones we last wrote.
///
/// Our archive wins the load order — that is what makes the patch work — so
/// reading the sources back through the full order hands our own output in as
/// its own input. The ledger would then record patched tables as the sources
/// they came from, every later check would compare a patched table against a
/// hash taken from a patched table, and the whole thing would be
/// self-consistent and wrong.
#[test]
fn a_rebuild_reads_the_clients_tables_and_not_its_own_output() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let recipe = shipped();

    let (first, first_built) = recipe::build(&recipe, root, "enUS").unwrap();
    let output = recipe.output_path(root, "enUS");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, &first).unwrap();

    // Our archive is now last in the load order, which is the point of it.
    let order = launcher_core::mpq::load_order(root, "enUS");
    assert_eq!(order.last().unwrap(), &output);
    // And it is not in the order the build reads sources under.
    let sources = recipe::source_order(&recipe, root, "enUS");
    assert!(
        !sources.contains(&output),
        "the build would read its own output: {sources:?}"
    );

    let (second, second_built) = recipe::build(&recipe, root, "enUS").unwrap();
    assert_eq!(
        first, second,
        "building again with the archive in place changed the result"
    );
    assert_eq!(
        first_built.sources, second_built.sources,
        "the recorded sources moved once our own archive was on disk"
    );
    for source in &second_built.sources {
        assert_ne!(
            source.archive,
            output.file_name().unwrap().to_string_lossy(),
            "a source table was read out of our own patch"
        );
    }

    // And the ledger still says the patch is current, rather than reporting
    // the client's tables as changed on every start.
    let entry = Entry {
        client_root: root.to_path_buf(),
        output: recipe.output_for("enUS"),
        built: second_built,
    };
    assert_eq!(
        ledger::need(&recipe, Some(&entry), root, "enUS").unwrap(),
        Need::UpToDate
    );
}

/* ------------------------------------------------------------------ *
 * The launcher, end to end: fetch, verify, build, gate.
 * ------------------------------------------------------------------ */

use std::collections::HashMap;
use std::sync::Mutex;

use launcher_core::app::{App, Http};
use launcher_core::error::{Error, Result};

struct FakeRealm {
    responses: HashMap<String, Vec<u8>>,
    asked: Mutex<Vec<String>>,
}

impl FakeRealm {
    fn new(pairs: Vec<(String, Vec<u8>)>) -> FakeRealm {
        FakeRealm {
            responses: pairs.into_iter().collect(),
            asked: Mutex::new(Vec::new()),
        }
    }
}

impl Http for FakeRealm {
    fn get(&self, url: &str) -> Result<Vec<u8>> {
        self.asked.lock().unwrap().push(url.to_string());
        self.responses
            .get(url)
            .cloned()
            .ok_or_else(|| Error::Message(format!("nothing served at {url}")))
    }
    fn post_json(&self, url: &str, _body: &str) -> Result<Vec<u8>> {
        self.get(url)
    }
}

const SITE: &str = "https://ashmorrow.example";
const RECIPE_URL: &str = "https://ashmorrow.example/patches/body-types.json";

/// A realm serving a manifest that publishes the shipped recipe.
fn realm(recipe_bytes: &[u8], published_hash: &str) -> FakeRealm {
    let recipe = shipped();
    let manifest = serde_json::json!({
        "schema": 1,
        "realm": { "name": "Ashmorrow", "address": "play.ashmorrow.example" },
        "client": { "build": 12340, "version": "3.3.5" },
        "recipes": [{
            "id": recipe.id,
            "version": recipe.version,
            "hash": published_hash,
            "url": RECIPE_URL,
            "summary": recipe.summary,
        }],
    });
    FakeRealm::new(vec![
        (
            format!("{SITE}/api/launcher/manifest"),
            serde_json::to_vec(&manifest).unwrap(),
        ),
        (RECIPE_URL.to_string(), recipe_bytes.to_vec()),
    ])
}

fn app_for(dir: &tempfile::TempDir, root: &Path) -> App {
    let mut app = App::new(
        SITE,
        dir.path().join("state/settings.json"),
        dir.path().join("state/hashes.json"),
    );
    app.choose_client(root).unwrap();
    app
}

fn recipe_bytes() -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("recipes/body-types.json"),
    )
    .unwrap()
}

/// The whole path: nothing built, build it, and the launch bar follows.
#[test]
fn the_launcher_builds_a_published_recipe_and_then_lets_you_launch() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let bytes = recipe_bytes();
    let http = realm(&bytes, blake3::hash(&bytes).to_hex().as_ref());

    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();

    // Before: it knows it has to build, and says so where a player looks.
    let states = app.check_recipes(&http).unwrap();
    assert_eq!(states.len(), 1);
    assert_eq!(states[0].need, Need::NeverBuilt);

    let status = app.status();
    assert!(
        !status.can_launch,
        "a client showing ten classes on a three-class realm must not launch"
    );
    assert!(
        status.rows.iter().any(|r| r.key == "BODY TYPES"),
        "the reason has to be on screen: {:?}",
        status.rows.iter().map(|r| &r.key).collect::<Vec<_>>()
    );
    // The label only reaches BUILD PATCH when nothing earlier is wrong, and on
    // a machine with no Wine the runtime blocks first. Asserting the string
    // unconditionally would make this test pass or fail on whether the runner
    // happens to have Wine installed, which is not what it is about.
    if status.blocked_because.is_empty() {
        assert_eq!(status.action, "BUILD PATCH");
    }

    // Build it.
    let steps = Mutex::new(Vec::new());
    let written = app
        .install_recipes(&http, &|note| steps.lock().unwrap().push(note.to_string()))
        .unwrap();
    assert_eq!(written, vec!["Data/enUS/patch-enUS-4.MPQ".to_string()]);
    assert!(
        !steps.lock().unwrap().is_empty(),
        "a multi-second job has to narrate itself"
    );

    // The archive is really there, and really wins the load order.
    let output = root.join("Data/enUS/patch-enUS-4.MPQ");
    assert!(output.is_file());
    assert_eq!(
        launcher_core::mpq::load_order(root, "enUS").last().unwrap(),
        &output
    );

    // After: up to date, and the bar says so.
    assert_eq!(app.recipe_states()[0].need, Need::UpToDate);
    let status = app.status();
    let row = status
        .rows
        .iter()
        .find(|r| r.key == "BODY TYPES")
        .expect("the row stays, saying it is done");
    assert_eq!(row.value, "built and current");
    assert_ne!(status.action, "BUILD PATCH");

    // And a second install is a no-op rather than a rewrite.
    let again = app.install_recipes(&http, &|_| {}).unwrap();
    assert!(again.is_empty(), "it rebuilt something that was current");
}

/// The recipe is fetched over the network and then executed against the
/// player's files. A hash that does not match the manifest stops it dead.
#[test]
fn a_recipe_that_fails_its_hash_is_never_applied() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let bytes = recipe_bytes();
    // The manifest publishes a hash for a different document.
    let http = realm(&bytes, &"a".repeat(64));

    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();

    let error = app.check_recipes(&http).unwrap_err().to_string();
    assert!(
        error.contains("does not match the hash"),
        "the refusal should say what happened: {error}"
    );
    assert!(
        error.contains("Nothing was applied"),
        "and that nothing happened: {error}"
    );

    let error = app.install_recipes(&http, &|_| {}).unwrap_err().to_string();
    assert!(error.contains("does not match the hash"), "{error}");
    assert!(
        !root.join("Data/enUS/patch-enUS-4.MPQ").exists(),
        "a recipe that failed verification wrote a file anyway"
    );
}

/// Someone else's patch in the slot: block, explain, and touch nothing.
#[test]
fn another_servers_patch_in_the_slot_blocks_the_launch() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let bytes = recipe_bytes();
    let http = realm(&bytes, blake3::hash(&bytes).to_hex().as_ref());

    let theirs = b"another server's patch-enUS-4";
    let output = root.join("Data/enUS/patch-enUS-4.MPQ");
    std::fs::write(&output, theirs).unwrap();

    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();
    let states = app.check_recipes(&http).unwrap();
    assert!(matches!(states[0].need, Need::NotOurs { .. }));

    let status = app.status();
    assert!(!status.can_launch);
    assert!(
        !status.blocked_because.is_empty(),
        "a blocked launcher must say why"
    );

    let error = app.install_recipes(&http, &|_| {}).unwrap_err().to_string();
    assert!(
        error.contains("did not put it there"),
        "the message must make clear whose file it is: {error}"
    );
    assert_eq!(
        std::fs::read(&output).unwrap(),
        theirs,
        "it overwrote a file it did not write"
    );
}

/// A realm that publishes no recipes leaves the launcher exactly as it was.
/// Ashmorrow is the only realm this launcher is for, but "the patch step does
/// nothing until a realm asks for it" is what makes the step safe to ship
/// before the recipe is published.
#[test]
fn a_realm_with_no_recipes_is_not_blocked_by_the_recipe_step() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let manifest = serde_json::json!({
        "schema": 1,
        "realm": { "name": "Ashmorrow", "address": "play.ashmorrow.example" },
        "client": { "build": 12340, "version": "3.3.5" },
    });
    let http = FakeRealm::new(vec![(
        format!("{SITE}/api/launcher/manifest"),
        serde_json::to_vec(&manifest).unwrap(),
    )]);

    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();
    assert!(app.check_recipes(&http).unwrap().is_empty());

    let status = app.status();
    assert_ne!(status.action, "BUILD PATCH");
    assert!(
        !status.rows.iter().any(|r| r.key == "BODY TYPES"),
        "a row about a patch no realm asked for is noise"
    );
    assert!(app.install_recipes(&http, &|_| {}).unwrap().is_empty());
}

/// The manifest entry and the recipe document carry the same facts twice, and
/// a disagreement is a mistake worth stopping for rather than picking a winner.
#[test]
fn the_manifest_and_the_recipe_have_to_agree_about_what_they_are() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let bytes = recipe_bytes();
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let recipe = shipped();

    let serve = |entry: serde_json::Value| {
        let manifest = serde_json::json!({
            "schema": 1,
            "realm": { "name": "Ashmorrow", "address": "play.ashmorrow.example" },
            "client": { "build": 12340, "version": "3.3.5" },
            "recipes": [entry],
        });
        FakeRealm::new(vec![
            (
                format!("{SITE}/api/launcher/manifest"),
                serde_json::to_vec(&manifest).unwrap(),
            ),
            (RECIPE_URL.to_string(), bytes.clone()),
        ])
    };
    let check = |entry: serde_json::Value| -> String {
        let http = serve(entry);
        let mut app = app_for(&dir, root);
        app.refresh_manifest(&http).unwrap();
        app.check_recipes(&http).unwrap_err().to_string()
    };

    // A version the document does not claim.
    let error = check(serde_json::json!({
        "id": recipe.id, "version": recipe.version + 1,
        "hash": hash, "url": RECIPE_URL,
    }));
    assert!(error.contains("version"), "{error}");

    // A size that does not match what arrived — reported as a delivery
    // problem, not as a hash mismatch.
    let error = check(serde_json::json!({
        "id": recipe.id, "version": recipe.version,
        "size": bytes.len() as u64 + 1,
        "hash": hash, "url": RECIPE_URL,
    }));
    assert!(error.contains("bytes"), "{error}");
    assert!(
        !error.contains("does not match the hash"),
        "a truncated download should not read as tampering: {error}"
    );

    // A revision on the manifest and none on the document is not a
    // disagreement: the recipe in the repository is unstamped until CI
    // stamps it, and rejecting that would make the file unusable locally.
    assert!(
        recipe.revision.is_empty(),
        "the shipped recipe is unstamped"
    );
    let http = serve(serde_json::json!({
        "id": recipe.id, "version": recipe.version,
        "hash": hash, "url": RECIPE_URL,
        "revision": "0123456789abcdef0123456789abcdef01234567",
    }));
    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();
    app.check_recipes(&http)
        .expect("an unstamped recipe must not be rejected for lacking a revision");

    // Two revisions that disagree is a real problem: the manifest was built
    // from a different recipe than the one being served.
    let stamped: Vec<u8> = {
        let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        value["revision"] = serde_json::json!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        serde_json::to_vec_pretty(&value).unwrap()
    };
    let manifest = serde_json::json!({
        "schema": 1,
        "realm": { "name": "Ashmorrow", "address": "play.ashmorrow.example" },
        "client": { "build": 12340, "version": "3.3.5" },
        "recipes": [{
            "id": recipe.id, "version": recipe.version,
            "hash": blake3::hash(&stamped).to_hex().to_string(),
            "url": RECIPE_URL,
            "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }],
    });
    let http = FakeRealm::new(vec![
        (
            format!("{SITE}/api/launcher/manifest"),
            serde_json::to_vec(&manifest).unwrap(),
        ),
        (RECIPE_URL.to_string(), stamped),
    ]);
    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();
    let error = app.check_recipes(&http).unwrap_err().to_string();
    assert!(error.contains("out of step"), "{error}");

    // And the entry the website actually serves: right id, version, size and
    // hash, no revision on either side. This must simply work.
    let http = serve(serde_json::json!({
        "id": recipe.id, "version": recipe.version,
        "size": bytes.len() as u64,
        "hash": hash, "url": RECIPE_URL,
        "summary": recipe.summary,
    }));
    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http).unwrap();
    assert_eq!(app.check_recipes(&http).unwrap()[0].need, Need::NeverBuilt);
}

/// Every hash in a manifest is BLAKE3, and nothing about the field says so.
///
/// A SHA-256 digest is also 64 lowercase hex characters, so a manifest built
/// with the wrong algorithm passes `Manifest::validate` and then fails on every
/// player's machine with a message that reads like tampering. Validation cannot
/// catch it — this test says so out loud, so the next person to write a
/// manifest generator finds the answer here rather than in a bug report.
#[test]
fn a_hash_of_the_right_shape_and_the_wrong_algorithm_passes_validation() {
    let dir = tempfile::tempdir().unwrap();
    let root = client(&dir);
    let bytes = recipe_bytes();

    // Stands in for any correctly-formed digest that is not this document's
    // BLAKE3: same length, same alphabet, same case.
    let wrong_algorithm = "9f".repeat(32);
    assert_eq!(wrong_algorithm.len(), 64);
    assert_ne!(wrong_algorithm, blake3::hash(&bytes).to_hex().to_string());

    let http = realm(&bytes, &wrong_algorithm);
    let mut app = app_for(&dir, root);
    app.refresh_manifest(&http)
        .expect("the manifest validates — the shape is indistinguishable");

    // It is caught at the fetch, before the document is parsed, and nothing
    // reaches the game directory.
    let error = app.check_recipes(&http).unwrap_err().to_string();
    assert!(error.contains("does not match the hash"), "{error}");
    assert!(!root.join("Data/enUS/patch-enUS-4.MPQ").exists());
}

/// The manifest validator and the transport have to agree about what may be
/// fetched, because they used to disagree and the symptom was unrelated: a
/// realm developed on loopback had its entire manifest rejected, and the
/// launcher reported the realm as unreachable.
#[test]
fn the_manifest_and_the_transport_allow_the_same_urls() {
    use launcher_core::manifest::{fetchable, Manifest};

    // https always; loopback plaintext because that is how a realm is stood up
    // locally, including by this test suite.
    for url in [
        "https://ashmorrow.example/patches/body-types.json",
        "http://127.0.0.1:8099/patches/body-types.json",
        "http://localhost:3000/patches/body-types.json",
    ] {
        assert!(fetchable(url), "{url} should be fetchable");
    }
    assert!(
        fetchable("http://[::1]:8099/x"),
        "the IPv6 loopback is loopback"
    );
    for url in [
        "http://mirror.example/body-types.json",
        "ftp://mirror.example/body-types.json",
        "file:///etc/passwd",
        // Every one of these begins with a loopback address and is served by
        // somebody else. A prefix match accepts them all.
        "http://127.0.0.1.evil.example/x",
        "http://localhost.evil.example/x",
        "http://127.0.0.1@evil.example/x",
        "http://127.0.0.1:8099@evil.example/x",
        "http://localhost:3000@evil.example/x",
        // And the near-misses that are not loopback at all.
        "http://127.0.0.2/x",
        "http://[::2]/x",
    ] {
        assert!(!fetchable(url), "{url} should not be fetchable");
    }

    // And a whole manifest carrying a loopback recipe validates, which is the
    // case that was broken.
    let manifest = serde_json::json!({
        "schema": 1,
        "realm": { "name": "Ashmorrow", "address": "play.ashmorrow.test" },
        "client": { "build": 12340, "version": "3.3.5" },
        "recipes": [{
            "id": "body-types", "version": 1,
            "hash": "0".repeat(64),
            "url": "http://127.0.0.1:8099/patches/body-types.json",
        }],
    });
    Manifest::parse(&serde_json::to_vec(&manifest).unwrap())
        .expect("a realm on loopback must be able to publish a recipe");
}
