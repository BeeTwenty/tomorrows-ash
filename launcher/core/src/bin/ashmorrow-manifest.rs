//! Generate and check the client half of a manifest.
//!
//! ```text
//! ashmorrow-manifest hash   <client-dir> [--all]   # emit the client.files array
//! ashmorrow-manifest check  <client-dir> <manifest.json>
//! ```
//!
//! Written in Rust rather than as a script beside the other tools for one
//! reason: the hashes it emits must be the same hashes `launcher_core::verify`
//! computes, and the only way to guarantee that is to call the same code. A
//! second implementation is a second thing to be subtly wrong.
//!
//! **What it emits is facts** — a path, a size and a hash per file. No bytes of
//! anyone's client leave the machine this runs on, which is why the output is
//! safe to commit and publish (ADR 0005, rule 4).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use launcher_core::client::Client;
use launcher_core::manifest::Manifest;
use launcher_core::verify::{self, hash_file, HashCache};

/// The files worth hashing: the archives the game actually reads, plus the
/// executable. Hashing the whole tree would add the player's own screenshots,
/// addons and WTF settings, none of which we have an opinion about.
fn is_interesting(path: &Path, all: bool) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    if name.eq_ignore_ascii_case("wow.exe") {
        return true;
    }
    if all {
        return true;
    }
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("mpq"))
}

fn walk(base: &Path, all: bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();

    for path in entries {
        if path.is_dir() {
            // Never follow the launcher's own backups back into the manifest.
            if path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with('.'))
            {
                continue;
            }
            walk(&path, all, out);
        } else if is_interesting(&path, all) {
            out.push(path);
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn hash(root: &Path, all: bool) -> Result<(), String> {
    let client = Client::detect(root).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    walk(root, all, &mut files);
    if files.is_empty() {
        return Err(format!("no client archives found under {}", root.display()));
    }

    eprintln!(
        "{} — {} files, {}",
        client
            .version
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown version".into()),
        files.len(),
        client.locales.join(", ")
    );

    let mut entries = Vec::new();
    for (index, path) in files.iter().enumerate() {
        let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        eprintln!("  [{}/{}] {}", index + 1, files.len(), relative(root, path));
        entries.push(serde_json::json!({
            "path": relative(root, path),
            "size": size,
            "hash": hash_file(path).map_err(|e| e.to_string())?,
        }));
    }

    let document = serde_json::json!({
        "build": client.build(),
        "version": client.version.map(|v| v.to_string()),
        "locales": client.locales,
        "files": entries,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&document).expect("plain data")
    );
    Ok(())
}

fn check(root: &Path, manifest_path: &Path) -> Result<bool, String> {
    let bytes = std::fs::read(manifest_path).map_err(|e| e.to_string())?;
    let manifest = Manifest::parse(&bytes).map_err(|e| e.to_string())?;

    let client = Client::detect(root).map_err(|e| e.to_string())?;
    if let Err(error) = client.require_build(manifest.client.build) {
        eprintln!("{error}");
    }

    let mut cache = HashCache::default();
    let report = verify::verify_client(root, &manifest, &mut cache, &|_| {});
    println!("{}", report.headline());
    for file in &report.files {
        if !file.state.is_match() {
            println!("  {} — {:?}", file.path, file.state);
        }
    }
    Ok(report.complete)
}

fn usage() -> ExitCode {
    eprintln!(
        "usage:\n  \
         ashmorrow-manifest hash  <client-dir> [--all]\n  \
         ashmorrow-manifest check <client-dir> <manifest.json>"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("hash") if args.len() >= 2 => {
            hash(Path::new(&args[1]), args.iter().any(|a| a == "--all")).map(|_| true)
        }
        Some("check") if args.len() >= 3 => check(Path::new(&args[1]), Path::new(&args[2])),
        _ => return usage(),
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
