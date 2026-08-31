//! Install a real DXVK release, not a synthetic one.
//!
//! The synthetic tarball in `provision.rs`'s unit tests is built to the layout
//! we *believe* DXVK ships. This test checks that belief against an actual
//! release, which is the only thing that can catch upstream changing the shape
//! of the archive.
//!
//! Opt-in, because CI has no business downloading 10 MB from GitHub on every
//! push. Point it at a release you have:
//!
//! ```text
//! curl -sSLO https://github.com/doitsujin/dxvk/releases/download/v2.7.1/dxvk-2.7.1.tar.gz
//! ASHMORROW_DXVK_TARBALL=$PWD/dxvk-2.7.1.tar.gz cargo test --test real_dxvk -- --nocapture
//! ```

use std::path::Path;

use launcher_core::provision::{install_dxvk, PrefixState};

fn prefix(dir: &Path, win64: bool) -> PrefixState {
    std::fs::create_dir_all(dir.join("drive_c/windows/system32")).unwrap();
    if win64 {
        std::fs::create_dir_all(dir.join("drive_c/windows/syswow64")).unwrap();
    }
    PrefixState::read(dir)
}

#[test]
fn a_real_dxvk_release_installs_into_a_prefix() {
    let Ok(tarball) = std::env::var("ASHMORROW_DXVK_TARBALL") else {
        eprintln!("skipped: set ASHMORROW_DXVK_TARBALL to a dxvk-*.tar.gz to run this");
        return;
    };
    let bytes = std::fs::read(&tarball).expect("the tarball named by ASHMORROW_DXVK_TARBALL");

    // Printed so a maintainer can paste real values straight into the manifest.
    println!("size: {}", bytes.len());
    println!("hash: {}", blake3::hash(&bytes).to_hex());

    for win64 in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let state = prefix(dir.path(), win64);

        let written = install_dxvk(&bytes, &state).expect("a real release should install");
        assert_eq!(written.len(), 1, "only the 32-bit d3d9.dll is wanted");

        let dll = &written[0];
        assert!(dll.ends_with(if win64 {
            "syswow64/d3d9.dll"
        } else {
            "system32/d3d9.dll"
        }));

        let contents = std::fs::read(dll).unwrap();
        assert!(contents.len() > 100_000, "a real d3d9.dll is not tiny");
        assert_eq!(&contents[..2], b"MZ", "it should be a PE image");

        assert!(
            PrefixState::read(dir.path()).has("dxvk"),
            "the prefix should now report dxvk as installed"
        );
    }
}
