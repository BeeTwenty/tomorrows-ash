//! The manifest: what the launcher is told about a realm, a client build, and
//! our own patches.
//!
//! The shape of these types is where ADR 0005's rules 1 and 4 are enforced.
//! [`ClientFile`] — an entry describing a *Blizzard* file — has a path, a size
//! and a hash, and **no field in which a download location could be written**.
//! It is `deny_unknown_fields`, so a manifest that tries to add one fails to
//! parse rather than being quietly ignored. [`Patch`] — an entry describing a
//! file *we* wrote — carries a URL, because that is the only kind of file this
//! launcher is allowed to fetch.
//!
//! A rule a type system enforces is a rule that survives a busy week.

use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::error::{Error, Result};

/// Bumped when a change would make an older launcher misread a manifest.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub realm: Realm,
    pub client: ClientSpec,
    #[serde(default)]
    pub patches: Vec<Patch>,
    /// Free software the launcher installs into its own Wine prefix so that
    /// a Linux player does not have to assemble a runtime by hand.
    #[serde(default)]
    pub runtime: Vec<RuntimeComponent>,
    #[serde(default)]
    pub launcher: LauncherSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Realm {
    pub name: String,
    /// What goes into `realmlist.wtf`. A hostname or an IP, never a URL.
    pub address: String,
    #[serde(default = "default_auth_port")]
    pub auth_port: u16,
    #[serde(default = "default_world_port")]
    pub world_port: u16,
}

fn default_auth_port() -> u16 {
    3724
}
fn default_world_port() -> u16 {
    8085
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientSpec {
    /// 12340 for 3.3.5a. Read back out of `Wow.exe` and compared.
    pub build: u32,
    pub version: String,
    /// Locales whose data directories we accept. Empty means "any".
    #[serde(default)]
    pub locales: Vec<String>,
    /// Where the hashes below were measured. Recorded so a player can tell
    /// whether "differs from known-good" means anything for their copy.
    #[serde(default)]
    pub measured_from: String,
    /// Known-good hashes. Advisory: a mismatch is reported, never blocked.
    #[serde(default)]
    pub files: Vec<ClientFile>,
}

/// A file belonging to Blizzard. Facts only — see the module docs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientFile {
    /// Relative to the client root, with `/` separators.
    pub path: String,
    pub size: u64,
    /// Lowercase hex BLAKE3.
    pub hash: String,
}

/// A file we wrote. This is the only kind of entry that may name a location.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Patch {
    pub id: String,
    pub version: u32,
    /// Where it is installed, relative to the client root.
    pub path: String,
    pub size: u64,
    pub hash: String,
    /// Must be `https://`. Fetched, verified against `hash`, then written.
    pub url: String,
    #[serde(default)]
    pub summary: String,
}

/// A piece of free software the launcher installs so the game will run.
///
/// Wine and DXVK are not ours and not Blizzard's — they are third-party free
/// software we are entitled to fetch and redistribute, which is what separates
/// this from a [`ClientFile`]. The same two invariants as [`Patch`] hold: an
/// `https` URL and a hash checked before anything is written.
///
/// The launcher installs these into **its own** Wine prefix, never a system
/// one. Nothing here is ever placed in the game directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeComponent {
    pub id: String,
    /// What it is, so the installer knows how to unpack it.
    pub kind: ComponentKind,
    pub version: String,
    pub size: u64,
    pub hash: String,
    /// Must be `https://`.
    pub url: String,
    /// The licence it is distributed under. Recorded so a release can state it.
    #[serde(default)]
    pub licence: String,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentKind {
    /// A DXVK release tarball: Direct3D over Vulkan, which is what makes a
    /// 2010 D3D9 game behave under Wine.
    Dxvk,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LauncherSpec {
    #[serde(default)]
    pub minimum_version: String,
    #[serde(default)]
    pub latest_version: String,
}

impl Manifest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let manifest: Manifest =
            serde_json::from_slice(bytes).map_err(|e| Error::BadManifest(e.to_string()))?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Everything that must be true before we act on a manifest.
    ///
    /// This runs against a document we fetched over the network, so it is a
    /// trust boundary: a compromised host must not be able to talk the launcher
    /// into writing outside the client directory or fetching over plaintext.
    pub fn validate(&self) -> Result<()> {
        let bad = |m: String| Err(Error::BadManifest(m));

        if self.schema != SCHEMA_VERSION {
            return bad(format!(
                "schema {} — this launcher understands {SCHEMA_VERSION}. Update the launcher.",
                self.schema
            ));
        }
        if self.realm.address.trim().is_empty() {
            return bad("realm.address is empty".into());
        }
        if self.realm.address.contains("://") || self.realm.address.contains('/') {
            return bad(format!(
                "realm.address must be a host or IP, not a URL: {}",
                self.realm.address
            ));
        }
        if self.client.build == 0 {
            return bad("client.build is missing".into());
        }

        for file in &self.client.files {
            safe_relative(&file.path)?;
            check_hash(&file.hash, &file.path)?;
        }

        for patch in &self.patches {
            safe_relative(&patch.path)?;
            check_hash(&patch.hash, &patch.path)?;
            if !patch.url.starts_with("https://") {
                return bad(format!(
                    "patch {} must be served over https, got {}",
                    patch.id, patch.url
                ));
            }
        }

        for component in &self.runtime {
            check_hash(&component.hash, &component.id)?;
            if !component.url.starts_with("https://") {
                return bad(format!(
                    "runtime component {} must be served over https, got {}",
                    component.id, component.url
                ));
            }
            if component.size == 0 {
                return bad(format!("runtime component {} has no size", component.id));
            }
        }

        Ok(())
    }

    pub fn patch_level(&self) -> u32 {
        self.patches.iter().map(|p| p.version).max().unwrap_or(0)
    }
}

/// Reject anything that could escape the client directory.
///
/// Both separators are checked because a manifest is written on one platform
/// and applied on another, and `..\..\windows\system32` is a perfectly ordinary
/// single path component to a Unix `Path`.
pub fn safe_relative(path: &str) -> Result<PathBuf> {
    let bad = |m: &str| Err(Error::BadManifest(format!("{path}: {m}")));

    if path.trim().is_empty() {
        return bad("empty path");
    }
    if path.contains('\\') {
        return bad("use / as the separator, not \\");
    }
    if path.contains('\0') {
        return bad("contains a null byte");
    }
    // A Windows drive letter or UNC prefix survives `Path::components` on Unix.
    if path.starts_with('/') || path.starts_with("//") || path.get(1..3) == Some(":/") {
        return bad("must be relative to the client directory");
    }

    let candidate = Path::new(path);
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => return bad("contains ."),
            Component::ParentDir => return bad("contains .."),
            Component::RootDir | Component::Prefix(_) => {
                return bad("must be relative to the client directory")
            }
        }
    }

    Ok(candidate.to_path_buf())
}

fn check_hash(hash: &str, path: &str) -> Result<()> {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::BadManifest(format!(
            "{path}: hash must be 64 hex characters, got {:?}",
            hash
        )));
    }
    if hash.bytes().any(|b| b.is_ascii_uppercase()) {
        return Err(Error::BadManifest(format!(
            "{path}: hash must be lowercase"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";

    fn minimal() -> String {
        format!(
            r#"{{
              "schema": 1,
              "realm": {{ "name": "Ashmorrow", "address": "play.ashmorrow.example" }},
              "client": {{ "build": 12340, "version": "3.3.5a",
                           "files": [{{ "path": "Data/common.MPQ", "size": 1, "hash": "{HASH}" }}] }}
            }}"#
        )
    }

    #[test]
    fn parses_a_minimal_manifest_and_defaults_the_ports() {
        let m = Manifest::parse(minimal().as_bytes()).unwrap();
        assert_eq!(m.realm.auth_port, 3724);
        assert_eq!(m.realm.world_port, 8085);
        assert_eq!(m.patch_level(), 0);
    }

    /// ADR 0005 rule 1, as a test. A client entry has nowhere to put a URL, and
    /// adding one must be an error rather than a field serde quietly drops.
    #[test]
    fn a_client_file_cannot_carry_a_download_location() {
        let json = minimal().replace(
            r#""size": 1"#,
            r#""size": 1, "url": "https://mirror.example/common.MPQ""#,
        );
        let err = Manifest::parse(json.as_bytes()).unwrap_err();
        assert!(
            err.to_string().contains("url"),
            "expected the unknown `url` field to be rejected, got: {err}"
        );
    }

    #[test]
    fn rejects_paths_that_escape_the_client_directory() {
        for path in [
            "../../etc/passwd",
            "/etc/passwd",
            "C:/Windows/System32/drivers/etc/hosts",
            "Data\\..\\..\\evil",
            "./Data/common.MPQ",
            "",
        ] {
            assert!(safe_relative(path).is_err(), "{path} should be rejected");
        }
        assert!(safe_relative("Data/enUS/realmlist.wtf").is_ok());
    }

    #[test]
    fn rejects_a_patch_served_over_plaintext() {
        let json = minimal().replace(
            r#""client":"#,
            &format!(
                r#""patches": [{{ "id": "p", "version": 1, "path": "Data/patch-4.MPQ",
                    "size": 1, "hash": "{HASH}", "url": "http://insecure.example/p.mpq" }}],
                   "client":"#
            ),
        );
        let err = Manifest::parse(json.as_bytes()).unwrap_err();
        assert!(err.to_string().contains("https"), "got: {err}");
    }

    #[test]
    fn rejects_a_realm_address_that_is_really_a_url() {
        let json = minimal().replace("play.ashmorrow.example", "https://play.ashmorrow.example");
        assert!(Manifest::parse(json.as_bytes()).is_err());
    }

    #[test]
    fn a_runtime_component_needs_https_and_a_hash() {
        let good = minimal().replace(
            r#""client":"#,
            &format!(
                r#""runtime": [{{ "id": "dxvk", "kind": "dxvk", "version": "2.4.1",
                    "size": 1, "hash": "{HASH}",
                    "url": "https://github.com/doitsujin/dxvk/releases/download/v2.4.1/dxvk-2.4.1.tar.gz" }}],
                   "client":"#
            ),
        );
        let manifest = Manifest::parse(good.as_bytes()).unwrap();
        assert_eq!(manifest.runtime.len(), 1);
        assert_eq!(manifest.runtime[0].kind, ComponentKind::Dxvk);

        let plaintext = good.replace("https://github.com", "http://github.com");
        assert!(Manifest::parse(plaintext.as_bytes()).is_err());

        let unsized_component = good.replace(r#""size": 1"#, r#""size": 0"#);
        assert!(Manifest::parse(unsized_component.as_bytes()).is_err());
    }

    #[test]
    fn rejects_a_malformed_hash() {
        let json = minimal().replace(HASH, "not-a-hash");
        assert!(Manifest::parse(json.as_bytes()).is_err());
    }
}
