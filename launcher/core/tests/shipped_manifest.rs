//! The manifest we actually ship has to load in the launcher we actually ship.
//!
//! It is a hand-edited JSON file that nothing else parses at build time, which
//! is exactly the kind of file that rots. This test is the thing that notices.

use std::path::PathBuf;

use launcher_core::manifest::Manifest;

fn manifests() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("launcher/core has a parent")
        .join("manifests")
}

#[test]
fn the_shipped_manifest_parses_and_validates() {
    let path = manifests().join("ashmorrow.json");
    let bytes = std::fs::read(&path).expect("launcher/manifests/ashmorrow.json is missing");

    let manifest = Manifest::parse(&bytes)
        .unwrap_or_else(|error| panic!("{} does not validate: {error}", path.display()));

    assert_eq!(manifest.client.build, 12340, "Ashmorrow is a 3.3.5a realm");
    assert!(!manifest.realm.name.is_empty());
}

/// ADR 0005 rule 1, checked against the bytes on disk rather than the type.
///
/// The type makes a download location for a Blizzard file unrepresentable; this
/// makes sure nobody has worked around that by putting one somewhere else in
/// the document, and it fails on the file a reviewer would actually read.
#[test]
fn no_manifest_names_a_place_to_get_a_client() {
    let forbidden = ["magnet:", ".torrent", "thepiratebay", "archive.org"];

    for entry in std::fs::read_dir(manifests()).expect("launcher/manifests exists") {
        let path = entry.expect("readable entry").path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("readable manifest");
        let lowered = text.to_lowercase();

        for needle in forbidden {
            assert!(
                !lowered.contains(needle),
                "{} contains {needle:?} — see docs/decisions/0005-client-distribution.md",
                path.display()
            );
        }
    }
}

/// The schema is published for anything that is not Rust to validate against,
/// so it has to stay in step with the parser's own idea of the version.
#[test]
fn the_schema_agrees_with_the_parser_about_the_version() {
    let text = std::fs::read_to_string(manifests().join("schema.json")).expect("schema.json");
    let schema: serde_json::Value = serde_json::from_str(&text).expect("schema.json is valid JSON");

    let declared = schema["properties"]["schema"]["const"]
        .as_u64()
        .expect("schema.json pins a const version");

    assert_eq!(declared as u32, launcher_core::manifest::SCHEMA_VERSION);
}
