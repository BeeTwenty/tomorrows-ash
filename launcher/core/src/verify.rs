//! Hashing a client and comparing it against the manifest.
//!
//! Tiers 2 and 3 of ADR 0006. Tier 2 — the player's own Blizzard files against
//! hashes we measured — is **advisory**: a difference is reported precisely and
//! never blocks a launch, because a client that differs from the one copy we
//! happened to measure is not thereby broken. Tier 3 — our own patch files
//! against our own hashes — blocks, because that half we actually control.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{IoContext, Result};
use crate::manifest::Manifest;

const READ_BUFFER: usize = 1024 * 1024;

/// Seconds and nanoseconds since the epoch. `None` on a filesystem that does
/// not report a modification time, which simply means nothing is cached.
type Mtime = Option<(u64, u32)>;

/// What we found for one file the manifest named.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum FileState {
    /// Size and hash both match.
    Match,
    /// Present, right size, different contents.
    Differs {
        expected: String,
        found: String,
    },
    /// Present, wrong size — checked before hashing, so this is cheap.
    WrongSize {
        expected: u64,
        found: u64,
    },
    Missing,
    /// There, but we could not read it. Usually permissions.
    Unreadable {
        reason: String,
    },
}

impl FileState {
    pub fn is_match(&self) -> bool {
        matches!(self, FileState::Match)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReport {
    pub path: String,
    pub state: FileState,
}

/// Everything the ledger screen renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    pub files: Vec<FileReport>,
    pub matched: usize,
    pub differing: usize,
    pub missing: usize,
    pub unreadable: usize,
    pub bytes_hashed: u64,
    /// True when every file the manifest named is present and identical.
    pub complete: bool,
}

impl Report {
    fn from(files: Vec<FileReport>, bytes_hashed: u64) -> Report {
        let mut report = Report {
            matched: 0,
            differing: 0,
            missing: 0,
            unreadable: 0,
            bytes_hashed,
            complete: false,
            files,
        };
        for file in &report.files {
            match file.state {
                FileState::Match => report.matched += 1,
                FileState::Differs { .. } | FileState::WrongSize { .. } => report.differing += 1,
                FileState::Missing => report.missing += 1,
                FileState::Unreadable { .. } => report.unreadable += 1,
            }
        }
        report.complete = report.matched == report.files.len();
        report
    }

    /// The one-line summary the main screen shows.
    pub fn headline(&self) -> String {
        if self.files.is_empty() {
            return "no file hashes published yet — structure checked only".into();
        }
        if self.complete {
            return format!("verified {} of {} files", self.matched, self.files.len());
        }
        let mut parts = Vec::new();
        if self.differing > 0 {
            parts.push(format!("{} differ", self.differing));
        }
        if self.missing > 0 {
            parts.push(format!("{} missing", self.missing));
        }
        if self.unreadable > 0 {
            parts.push(format!("{} unreadable", self.unreadable));
        }
        format!(
            "{} of {} verified — {}",
            self.matched,
            self.files.len(),
            parts.join(", ")
        )
    }
}

/// How far along a verification run is. Handed to the caller's callback from
/// whichever worker thread finished a file, so the callback must be `Sync`.
#[derive(Debug, Clone, Copy)]
pub struct Progress {
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

/// Remembers what a file hashed to last time, so an unchanged 15 GB client is
/// re-verified in seconds rather than minutes.
///
/// Keyed on size *and* modification time: a file that changed without either
/// changing would slip through, which is why the full re-hash exists as an
/// explicit choice in the UI rather than being something we quietly skip.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct HashCache {
    #[serde(default)]
    entries: HashMap<String, CacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    size: u64,
    mtime_secs: u64,
    mtime_nanos: u32,
    hash: String,
}

impl HashCache {
    pub fn load(path: &Path) -> HashCache {
        // A missing or corrupt cache costs time, never correctness, so it is
        // never an error worth showing anyone.
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).at(parent)?;
        }
        let bytes = serde_json::to_vec(self).expect("cache is plain data");
        std::fs::write(path, bytes).at(path)
    }

    fn get(&self, key: &str, size: u64, mtime: Mtime) -> Option<&str> {
        let entry = self.entries.get(key)?;
        let (secs, nanos) = mtime?;
        (entry.size == size && entry.mtime_secs == secs && entry.mtime_nanos == nanos)
            .then_some(entry.hash.as_str())
    }

    fn put(&mut self, key: String, size: u64, mtime: Mtime, hash: String) {
        let Some((mtime_secs, mtime_nanos)) = mtime else {
            return;
        };
        self.entries.insert(
            key,
            CacheEntry {
                size,
                mtime_secs,
                mtime_nanos,
                hash,
            },
        );
    }
}

/// BLAKE3 of a file, streamed. Chosen over SHA-256 because verification reads
/// the whole client and BLAKE3 is several times faster per core.
pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path).at(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; READ_BUFFER];
    loop {
        let read = file.read(&mut buffer).at(path)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn mtime_of(meta: &std::fs::Metadata) -> Mtime {
    let modified = meta.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some((since.as_secs(), since.subsec_nanos()))
}

/// A file we hashed this run, ready to be written back into the cache once the
/// parallel section has finished and `&mut HashCache` is available again.
struct FreshHash {
    size: u64,
    mtime: Mtime,
    hash: String,
}

/// One file's verdict, tagged with its manifest position so the ledger's order
/// is ours rather than whichever worker happened to finish first.
struct Verified {
    index: usize,
    report: FileReport,
    fresh: Option<FreshHash>,
}

/// Verify every file the manifest names, in parallel, against `root`.
///
/// `cache` is consulted and updated; pass a default one to force a full re-hash.
pub fn verify_client(
    root: &Path,
    manifest: &Manifest,
    cache: &mut HashCache,
    progress: &(dyn Fn(Progress) + Sync),
) -> Report {
    let wanted = &manifest.client.files;
    let files_total = wanted.len() as u64;
    let bytes_total: u64 = wanted.iter().map(|f| f.size).sum();

    let files_done = AtomicU64::new(0);
    let bytes_done = AtomicU64::new(0);
    let bytes_hashed = AtomicU64::new(0);

    // Read the cache before the parallel section: `&HashCache` is `Sync`, and
    // the writes are collected and applied afterwards rather than locked.
    let snapshot: &HashCache = cache;

    let mut results: Vec<Verified> = wanted
        .par_iter()
        .enumerate()
        .map(|(index, wanted)| {
            let path = root.join(&wanted.path);
            let mut fresh = None;

            let state = match std::fs::metadata(&path) {
                Err(_) => FileState::Missing,
                Ok(meta) if meta.len() != wanted.size => FileState::WrongSize {
                    expected: wanted.size,
                    found: meta.len(),
                },
                Ok(meta) => {
                    let mtime = mtime_of(&meta);
                    match snapshot.get(&wanted.path, meta.len(), mtime) {
                        Some(cached) => compare(cached, &wanted.hash),
                        None => match hash_file(&path) {
                            Ok(hash) => {
                                bytes_hashed.fetch_add(meta.len(), Ordering::Relaxed);
                                let state = compare(&hash, &wanted.hash);
                                fresh = Some(FreshHash {
                                    size: meta.len(),
                                    mtime,
                                    hash,
                                });
                                state
                            }
                            Err(error) => FileState::Unreadable {
                                reason: error.to_string(),
                            },
                        },
                    }
                }
            };

            progress(Progress {
                files_done: files_done.fetch_add(1, Ordering::Relaxed) + 1,
                files_total,
                bytes_done: bytes_done.fetch_add(wanted.size, Ordering::Relaxed) + wanted.size,
                bytes_total,
            });

            Verified {
                index,
                report: FileReport {
                    path: wanted.path.clone(),
                    state,
                },
                fresh,
            }
        })
        .collect();

    // rayon returns in order for an indexed parallel iterator, but sorting makes
    // that a property of this function rather than of the library.
    results.sort_by_key(|verified| verified.index);

    let mut reports = Vec::with_capacity(results.len());
    for Verified { report, fresh, .. } in results {
        if let Some(FreshHash { size, mtime, hash }) = fresh {
            cache.put(report.path.clone(), size, mtime, hash);
        }
        reports.push(report);
    }

    Report::from(reports, bytes_hashed.load(Ordering::Relaxed))
}

/// Tier 3: our own files, which must match exactly.
pub fn verify_patches(root: &Path, manifest: &Manifest) -> Report {
    let reports = manifest
        .patches
        .par_iter()
        .map(|patch| {
            let path = root.join(&patch.path);
            let state = match std::fs::metadata(&path) {
                Err(_) => FileState::Missing,
                Ok(meta) if meta.len() != patch.size => FileState::WrongSize {
                    expected: patch.size,
                    found: meta.len(),
                },
                Ok(_) => match hash_file(&path) {
                    Ok(hash) => compare(&hash, &patch.hash),
                    Err(error) => FileState::Unreadable {
                        reason: error.to_string(),
                    },
                },
            };
            FileReport {
                path: patch.path.clone(),
                state,
            }
        })
        .collect::<Vec<_>>();

    Report::from(reports, 0)
}

fn compare(found: &str, expected: &str) -> FileState {
    if found.eq_ignore_ascii_case(expected) {
        FileState::Match
    } else {
        FileState::Differs {
            expected: expected.to_string(),
            found: found.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Manifest;

    fn manifest_for(files: &[(&str, u64, &str)]) -> Manifest {
        let entries: Vec<String> = files
            .iter()
            .map(|(path, size, hash)| {
                format!(r#"{{"path":"{path}","size":{size},"hash":"{hash}"}}"#)
            })
            .collect();
        let json = format!(
            r#"{{"schema":1,
                 "realm":{{"name":"Ashmorrow","address":"ashmorrow.example"}},
                 "client":{{"build":12340,"version":"3.3.5","files":[{}]}}}}"#,
            entries.join(",")
        );
        Manifest::parse(json.as_bytes()).unwrap()
    }

    fn write(root: &Path, rel: &str, contents: &[u8]) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn hash_of(contents: &[u8]) -> String {
        blake3::hash(contents).to_hex().to_string()
    }

    #[test]
    fn reports_a_match_a_difference_and_an_absence() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "Data/good.MPQ", b"good contents");
        write(root, "Data/bad.MPQ", b"not what we measured");

        let manifest = manifest_for(&[
            ("Data/good.MPQ", 13, &hash_of(b"good contents")),
            ("Data/bad.MPQ", 20, &hash_of(b"something else here!")),
            ("Data/gone.MPQ", 4, &hash_of(b"gone")),
        ]);

        let mut cache = HashCache::default();
        let report = verify_client(root, &manifest, &mut cache, &|_| {});

        assert_eq!(report.matched, 1);
        assert_eq!(report.differing, 1);
        assert_eq!(report.missing, 1);
        assert!(!report.complete);
        assert!(matches!(report.files[1].state, FileState::Differs { .. }));
        assert_eq!(report.files[2].state, FileState::Missing);
        // Order follows the manifest, so the ledger is stable between runs.
        assert_eq!(report.files[0].path, "Data/good.MPQ");
    }

    #[test]
    fn a_wrong_size_is_caught_without_hashing_the_file() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "Data/short.MPQ", b"tiny");

        let manifest = manifest_for(&[("Data/short.MPQ", 999, &hash_of(b"tiny"))]);
        let mut cache = HashCache::default();
        let report = verify_client(dir.path(), &manifest, &mut cache, &|_| {});

        assert_eq!(
            report.files[0].state,
            FileState::WrongSize {
                expected: 999,
                found: 4
            }
        );
        assert_eq!(
            report.bytes_hashed, 0,
            "a size mismatch must not read the file"
        );
    }

    #[test]
    fn the_cache_saves_the_second_pass_from_re_reading_anything() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "Data/big.MPQ", b"contents that stay put");
        let manifest = manifest_for(&[("Data/big.MPQ", 22, &hash_of(b"contents that stay put"))]);

        let mut cache = HashCache::default();
        let first = verify_client(dir.path(), &manifest, &mut cache, &|_| {});
        assert_eq!(first.bytes_hashed, 22);

        let second = verify_client(dir.path(), &manifest, &mut cache, &|_| {});
        assert!(second.complete);
        assert_eq!(second.bytes_hashed, 0, "the cache should have answered");
    }

    #[test]
    fn the_cache_survives_a_round_trip_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "Data/big.MPQ", b"stable");
        let manifest = manifest_for(&[("Data/big.MPQ", 6, &hash_of(b"stable"))]);

        let cache_path = dir.path().join("state/hashes.json");
        let mut cache = HashCache::default();
        verify_client(dir.path(), &manifest, &mut cache, &|_| {});
        cache.save(&cache_path).unwrap();

        let mut reloaded = HashCache::load(&cache_path);
        let report = verify_client(dir.path(), &manifest, &mut reloaded, &|_| {});
        assert_eq!(report.bytes_hashed, 0);
    }

    #[test]
    fn progress_reaches_the_totals_exactly_once_each() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a", "b", "c"] {
            write(dir.path(), &format!("Data/{name}.MPQ"), name.as_bytes());
        }
        let manifest = manifest_for(&[
            ("Data/a.MPQ", 1, &hash_of(b"a")),
            ("Data/b.MPQ", 1, &hash_of(b"b")),
            ("Data/c.MPQ", 1, &hash_of(b"c")),
        ]);

        let seen = std::sync::Mutex::new(Vec::new());
        let mut cache = HashCache::default();
        verify_client(dir.path(), &manifest, &mut cache, &|p| {
            seen.lock().unwrap().push(p.files_done);
        });

        let mut seen = seen.into_inner().unwrap();
        seen.sort_unstable();
        assert_eq!(seen, [1, 2, 3]);
    }

    #[test]
    fn an_empty_manifest_verifies_vacuously_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = manifest_for(&[]);
        let mut cache = HashCache::default();
        let report = verify_client(dir.path(), &manifest, &mut cache, &|_| {});
        assert!(report.complete);
        assert!(report.headline().contains("no file hashes published"));
    }
}
