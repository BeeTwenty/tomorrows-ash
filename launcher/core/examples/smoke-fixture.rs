//! Scaffolding for `launcher/test/smoke-linux.sh`.
//!
//! An example rather than a binary: it must never ship to a player. It exists
//! so the smoke harness builds the *same* tables the Rust tests use and hashes
//! them with the *same* function the launcher verifies with — a fixture that
//! drifts from the one under test is how the recipe came to point one column
//! past the class name for a week, and a hash from a different algorithm is the
//! same shape as the right one and fails only on a player's machine.
//!
//!   cargo run --example smoke-fixture -- client <dir>
//!   cargo run --example smoke-fixture -- hash <file>

#[path = "../tests/common/mod.rs"]
mod common;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["client", root] => {
            common::write_client(
                std::path::Path::new(root),
                common::StringBlock::Conventional,
            );
            println!("{root}");
        }
        ["hash", file] => {
            let bytes = std::fs::read(file).unwrap_or_else(|e| panic!("{file}: {e}"));
            println!("{}", blake3::hash(&bytes).to_hex());
        }
        _ => {
            eprintln!("usage: smoke-fixture client <dir> | hash <file>");
            std::process::exit(2);
        }
    }
}
