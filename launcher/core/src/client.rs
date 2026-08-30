//! Finding a World of Warcraft client on disk and working out what it is.
//!
//! Tier 1 of the three-tier check in ADR 0006: before any hashing happens, is
//! this a 3.3.5a build 12340 client at all? That question is answered from the
//! executable's own version resource rather than from folder names, because
//! folder names are whatever the last person to rename them felt like.

use std::path::{Path, PathBuf};

use crate::error::{Error, IoContext, Result};

/// Locale directories WoW 3.3.5a ships. A client has exactly one, normally.
const KNOWN_LOCALES: &[&str] = &[
    "enUS", "enGB", "enCN", "enTW", "deDE", "esES", "esMX", "frFR", "itIT", "koKR", "ptBR", "ptPT",
    "ruRU", "zhCN", "zhTW",
];

/// Reading more than this out of `Wow.exe` means something is wrong with our
/// assumptions, not with the client. The real one is around 7 MB.
const MAX_EXECUTABLE_BYTES: u64 = 64 * 1024 * 1024;

/// A four-part Windows file version, exactly as the executable states it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileVersion {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
    pub build: u16,
}

impl std::fmt::Display for FileVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}.{}.{}.{}",
            self.major, self.minor, self.patch, self.build
        )
    }
}

/// What we found at a path the player pointed us at.
#[derive(Debug, Clone)]
pub struct Client {
    pub root: PathBuf,
    pub executable: PathBuf,
    /// `None` when the executable had no readable version resource. That is a
    /// warning, not a refusal — some repacks strip it.
    pub version: Option<FileVersion>,
    /// Locale directories found under `Data/`, in the order they were listed.
    pub locales: Vec<String>,
}

impl Client {
    /// Look at `root` and describe what is there. Fails only when there is no
    /// client at all; everything else is reported as a field for the caller to
    /// judge.
    pub fn detect(root: impl AsRef<Path>) -> Result<Client> {
        let root = root.as_ref();
        let executable =
            find_executable(root).ok_or_else(|| Error::NoClient(root.to_path_buf()))?;

        let version = match std::fs::metadata(&executable) {
            Ok(meta) if meta.len() <= MAX_EXECUTABLE_BYTES => {
                let bytes = std::fs::read(&executable).at(&executable)?;
                read_file_version(&bytes)
            }
            _ => None,
        };

        Ok(Client {
            root: root.to_path_buf(),
            locales: find_locales(root),
            executable,
            version,
        })
    }

    /// The build number the client reports, if it reported one.
    ///
    /// WoW's build lives in the fourth component: a 3.3.5a client states
    /// `3.3.5.12340`. If a real client ever disagrees, the error text from
    /// [`Client::require_build`] prints the whole version string, so the
    /// mismatch is visible rather than mysterious.
    pub fn build(&self) -> Option<u32> {
        self.version.map(|v| u32::from(v.build))
    }

    /// Tier 1, the one check that blocks.
    pub fn require_build(&self, wanted: u32) -> Result<()> {
        match self.build() {
            Some(found) if found == wanted => Ok(()),
            Some(_) => Err(Error::WrongBuild {
                path: self.root.clone(),
                // The whole version, not just the build: if our assumption
                // about which component is the build is ever wrong, this is
                // where a human sees it immediately.
                found: self
                    .version
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "unknown".into()),
                wanted,
            }),
            None => Err(Error::UnreadableBuild(self.executable.clone())),
        }
    }

    /// The locale whose data directory we will write `realmlist.wtf` into.
    pub fn primary_locale(&self) -> Result<&str> {
        self.locales
            .first()
            .map(String::as_str)
            .ok_or_else(|| Error::NoLocale(self.root.join("Data")))
    }

    /// Every `realmlist.wtf` this client might read.
    ///
    /// Deliberately all of them. Which one a given build honours depends on the
    /// client, and writing the same single line into each is harmless — the
    /// realmlist file has no other contents worth preserving.
    pub fn realmlist_paths(&self) -> Vec<PathBuf> {
        self.locales
            .iter()
            .map(|locale| self.root.join("Data").join(locale).join("realmlist.wtf"))
            .collect()
    }

    pub fn config_wtf(&self) -> PathBuf {
        self.root.join("WTF").join("Config.wtf")
    }
}

/// Windows is case-insensitive and Linux is not, so a client copied from a CD
/// on one and used on the other can be `WoW.exe`, `Wow.exe` or `wow.exe`.
fn find_executable(root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.eq_ignore_ascii_case("wow.exe") {
            return Some(entry.path());
        }
    }
    None
}

fn find_locales(root: &Path) -> Vec<String> {
    let data = root.join("Data");
    let Ok(entries) = std::fs::read_dir(&data) else {
        return Vec::new();
    };

    let mut found: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            KNOWN_LOCALES
                .iter()
                .find(|known| known.eq_ignore_ascii_case(&name))
                // Normalise to the canonical spelling so downstream string
                // comparisons do not have to care about the filesystem's case.
                .map(|known| (*known).to_string())
        })
        .collect();

    found.sort();
    found.dedup();
    found
}

/* -------------------------------------------------------------------------- *
 * Reading a version out of a PE executable
 * -------------------------------------------------------------------------- */

/// `VS_FIXEDFILEINFO.dwSignature`, little-endian on disk.
const VS_FIXEDFILEINFO_SIGNATURE: [u8; 4] = [0xBD, 0x04, 0xEF, 0xFE];

/// Pull the four-part file version out of a PE image.
///
/// We locate `.rsrc` through the section table and scan only inside it for the
/// `VS_FIXEDFILEINFO` signature, rather than walking the resource directory
/// tree. The tree walk is three more layers of structure for the same answer;
/// scanning a bounded, correct region is enough, and if the section table is
/// unreadable we fall back to scanning the whole image.
pub fn read_file_version(image: &[u8]) -> Option<FileVersion> {
    let region = rsrc_section(image).unwrap_or((0, image.len()));
    let (start, end) = region;
    let haystack = image.get(start..end)?;

    let mut offset = 0usize;
    while let Some(found) = find(&haystack[offset..], &VS_FIXEDFILEINFO_SIGNATURE) {
        let at = offset + found;
        if let Some(version) = fixed_file_info(haystack, at) {
            return Some(version);
        }
        offset = at + 4;
    }
    None
}

fn fixed_file_info(bytes: &[u8], at: usize) -> Option<FileVersion> {
    // dwSignature, dwStrucVersion, dwFileVersionMS, dwFileVersionLS
    let ms = u32_le(bytes, at + 8)?;
    let ls = u32_le(bytes, at + 12)?;
    let version = FileVersion {
        major: (ms >> 16) as u16,
        minor: (ms & 0xFFFF) as u16,
        patch: (ls >> 16) as u16,
        build: (ls & 0xFFFF) as u16,
    };
    // A four-byte signature will occasionally appear in ordinary data. A real
    // version resource has a non-zero major; random bytes usually do not
    // survive that plus the struct-version check.
    let struc = u32_le(bytes, at + 4)?;
    (version.major != 0 && struc != 0).then_some(version)
}

/// Byte range of the `.rsrc` section within the file, if the headers parse.
fn rsrc_section(image: &[u8]) -> Option<(usize, usize)> {
    if image.get(..2)? != b"MZ" {
        return None;
    }
    let pe_offset = u32_le(image, 0x3C)? as usize;
    if image.get(pe_offset..pe_offset + 4)? != b"PE\0\0" {
        return None;
    }

    // COFF file header, immediately after the PE signature.
    let coff = pe_offset + 4;
    let section_count = u16_le(image, coff + 2)? as usize;
    let optional_header_size = u16_le(image, coff + 16)? as usize;
    let mut section = coff + 20 + optional_header_size;

    for _ in 0..section_count {
        let name = image.get(section..section + 8)?;
        if name.starts_with(b".rsrc") {
            let size = u32_le(image, section + 16)? as usize;
            let pointer = u32_le(image, section + 20)? as usize;
            let end = pointer.checked_add(size)?;
            if pointer < image.len() && end <= image.len() {
                return Some((pointer, end));
            }
            return None;
        }
        section += 40;
    }
    None
}

fn u16_le(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_le(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A byte buffer holding a `VS_FIXEDFILEINFO` that states 3.3.5.12340 —
    /// the version a WoW 3.3.5a client reports.
    fn wotlk_version_blob() -> Vec<u8> {
        let mut bytes = vec![0x11; 128];
        bytes.extend_from_slice(&VS_FIXEDFILEINFO_SIGNATURE);
        bytes.extend_from_slice(&0x0001_0000u32.to_le_bytes()); // dwStrucVersion
        bytes.extend_from_slice(&((3u32 << 16) | 3).to_le_bytes()); // MS: 3.3
        bytes.extend_from_slice(&((5u32 << 16) | 12340).to_le_bytes()); // LS: 5.12340
        bytes.extend_from_slice(&[0x22; 64]);
        bytes
    }

    #[test]
    fn reads_the_version_a_wotlk_client_reports() {
        let version = read_file_version(&wotlk_version_blob()).unwrap();
        assert_eq!(version.to_string(), "3.3.5.12340");
        assert_eq!(u32::from(version.build), 12340);
    }

    #[test]
    fn ignores_a_signature_that_is_not_a_version_resource() {
        // Signature followed by zeroes: no struct version, no major.
        let mut bytes = vec![0u8; 32];
        bytes.extend_from_slice(&VS_FIXEDFILEINFO_SIGNATURE);
        bytes.extend_from_slice(&[0u8; 32]);
        assert!(read_file_version(&bytes).is_none());
    }

    #[test]
    fn returns_nothing_rather_than_panicking_on_a_truncated_image() {
        assert!(read_file_version(&[]).is_none());
        assert!(read_file_version(b"MZ").is_none());
        assert!(read_file_version(&VS_FIXEDFILEINFO_SIGNATURE).is_none());
    }

    fn fake_client(dir: &Path, locale: &str, version_blob: &[u8]) {
        std::fs::create_dir_all(dir.join("Data").join(locale)).unwrap();
        std::fs::create_dir_all(dir.join("WTF")).unwrap();
        std::fs::write(dir.join("Wow.exe"), version_blob).unwrap();
    }

    #[test]
    fn detects_a_client_its_locale_and_its_build() {
        let dir = tempfile::tempdir().unwrap();
        fake_client(dir.path(), "enUS", &wotlk_version_blob());

        let client = Client::detect(dir.path()).unwrap();
        assert_eq!(client.locales, ["enUS"]);
        assert_eq!(client.build(), Some(12340));
        assert!(client.require_build(12340).is_ok());
        assert_eq!(
            client.realmlist_paths(),
            [dir.path().join("Data/enUS/realmlist.wtf")]
        );
    }

    #[test]
    fn names_the_build_it_found_when_it_is_the_wrong_one() {
        let dir = tempfile::tempdir().unwrap();
        let mut blob = vec![0x11; 8];
        blob.extend_from_slice(&VS_FIXEDFILEINFO_SIGNATURE);
        blob.extend_from_slice(&0x0001_0000u32.to_le_bytes());
        blob.extend_from_slice(&((2u32 << 16) | 4).to_le_bytes());
        blob.extend_from_slice(&((3u32 << 16) | 8606).to_le_bytes());
        fake_client(dir.path(), "deDE", &blob);

        let client = Client::detect(dir.path()).unwrap();
        let message = client.require_build(12340).unwrap_err().to_string();
        assert!(message.contains("2.4.3.8606"), "got: {message}");
        assert!(message.contains("12340"), "got: {message}");
    }

    #[test]
    fn a_directory_with_no_executable_is_not_a_client() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Data/enUS")).unwrap();
        assert!(matches!(
            Client::detect(dir.path()),
            Err(Error::NoClient(_))
        ));
    }

    #[test]
    fn a_client_with_no_locale_directory_says_so() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Data")).unwrap();
        std::fs::write(dir.path().join("wow.exe"), wotlk_version_blob()).unwrap();

        let client = Client::detect(dir.path()).unwrap();
        assert!(client.locales.is_empty());
        assert!(matches!(client.primary_locale(), Err(Error::NoLocale(_))));
    }
}
