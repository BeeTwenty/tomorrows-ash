//! What the launcher remembers between runs.
//!
//! Deliberately small, and deliberately not a place credentials go: the only
//! account detail stored is the name, which the client itself already keeps in
//! `Config.wtf`. Session tokens belong in the OS keyring, which the shell owns.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{IoContext, Result};
use crate::launch::Renderer;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// The client directory the player chose.
    pub client_path: Option<PathBuf>,
    /// Overrides the manifest's realm address. For testing against a LAN realm.
    pub realm_address: Option<String>,
    /// The website the manifest is fetched from.
    ///
    /// A setting rather than a compile-time constant because a player running
    /// their own realm has their own site, and because the built-in default
    /// points at a deployment that may not exist yet — which must be a thing
    /// you can fix from the interface, not a reason the launcher is useless.
    pub realm_site: Option<String>,
    /// Name of the Wine or Proton runtime last used, matched against discovery.
    pub runtime_name: Option<String>,
    pub prefix: Option<PathBuf>,
    pub renderer: Renderer,
    pub windowed: bool,
    /// Pre-filled on the client's login screen. Never a password.
    pub account_name: Option<String>,
    pub extra_args: Vec<String>,
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        // Settings that fail to parse are settings from a newer launcher, or a
        // half-written file. Starting from defaults is better than refusing to
        // start at all.
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).at(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self).expect("settings are plain data");
        std::fs::write(path, bytes).at(path)
    }
}

/// Where the launcher keeps its own files.
///
/// `%APPDATA%\Ashmorrow` on Windows, `$XDG_CONFIG_HOME/ashmorrow` elsewhere.
pub fn config_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        return std::env::var_os("APPDATA")
            .filter(|v| !v.is_empty())
            .map(|appdata| PathBuf::from(appdata).join("Ashmorrow"));
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(xdg).join("ashmorrow"));
    }
    crate::wine::home_dir().map(|home| home.join(".config/ashmorrow"))
}

pub fn settings_path() -> Option<PathBuf> {
    Some(config_dir()?.join("settings.json"))
}

pub fn cache_path() -> Option<PathBuf> {
    Some(config_dir()?.join("hashes.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/settings.json");

        let settings = Settings {
            client_path: Some(PathBuf::from("/games/wow")),
            renderer: Renderer::OpenGl,
            windowed: true,
            account_name: Some("ashadmin".into()),
            ..Settings::default()
        };
        settings.save(&path).unwrap();

        let loaded = Settings::load(&path);
        assert_eq!(loaded.client_path, settings.client_path);
        assert_eq!(loaded.renderer, Renderer::OpenGl);
        assert!(loaded.windowed);
        assert_eq!(loaded.account_name.as_deref(), Some("ashadmin"));
    }

    #[test]
    fn unreadable_settings_fall_back_to_defaults_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"{ this is not json").unwrap();

        let loaded = Settings::load(&path);
        assert!(loaded.client_path.is_none());
        assert_eq!(loaded.renderer, Renderer::Direct3D);
    }

    #[test]
    fn a_settings_file_from_a_newer_launcher_still_loads_what_it_can() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            br#"{"client_path":"/games/wow","something_we_do_not_know_about":42}"#,
        )
        .unwrap();

        assert_eq!(
            Settings::load(&path).client_path,
            Some(PathBuf::from("/games/wow"))
        );
    }
}
