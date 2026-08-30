//! The launcher's state machine.
//!
//! Everything the window does, minus the window. The Tauri shell owns a single
//! [`App`] and forwards commands to it, which keeps the shell down to argument
//! marshalling and keeps this — the part that can go wrong — under test.
//!
//! Network access arrives through the [`Http`] trait rather than a client this
//! crate constructs, for two reasons: the tests can hand it a fake, and the
//! transport (TLS, proxies, timeouts) stays the shell's problem.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::error::{Error, Result};
use crate::install;
use crate::launch::{self, LaunchOptions, LaunchPlan, Platform};
use crate::manifest::Manifest;
use crate::settings::Settings;
use crate::verify::{self, HashCache, Progress, Report};
use crate::wine::{self, Runtime};

/// The bytes-in, bytes-out surface the launcher needs from the network.
pub trait Http: Send + Sync {
    fn get(&self, url: &str) -> Result<Vec<u8>>;
    fn post_json(&self, url: &str, body: &str) -> Result<Vec<u8>>;
}

/// Signed-in account, as the website describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub username: String,
    #[serde(default)]
    pub characters: u32,
    /// Short-lived. Held in memory only — the shell puts it in the OS keyring.
    #[serde(default)]
    pub token: String,
}

/// The complete set of things a status row can mean.
///
/// This is the UI's only colour input, and it is a closed enum on purpose:
/// LAUNCHER-DESIGN's first rule is that colour carries information and nothing
/// else, so there is exactly one place where a new colour could be introduced
/// and it is here, where it has to be given a meaning first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RowState {
    /// Verified, done, correct.
    Ok,
    /// Will still run, but the player should know.
    Warn,
    /// Will not run until this is fixed.
    Block,
    /// Working on it right now.
    Busy,
    /// Nothing has happened here yet, and that is fine.
    Idle,
}

/// One line of the launcher's main screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    pub key: String,
    pub value: String,
    pub state: RowState,
    #[serde(default)]
    pub detail: String,
}

/// Everything the readout strip and the status rows render from.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub realm: String,
    pub realm_address: String,
    pub client_version: String,
    pub patch_level: u32,
    pub runtime: String,
    pub rows: Vec<Row>,
    /// What the launch bar says right now. Never a lie — see LAUNCHER-DESIGN §3.
    pub action: String,
    pub can_launch: bool,
    #[serde(default)]
    pub blocked_because: String,
}

pub struct App {
    pub settings: Settings,
    settings_path: PathBuf,
    cache_path: PathBuf,
    base_url: String,
    manifest: Option<Manifest>,
    client: Option<Client>,
    last_report: Option<Report>,
    account: Option<Account>,
    runtimes: Vec<Runtime>,
}

impl App {
    pub fn new(base_url: impl Into<String>, settings_path: PathBuf, cache_path: PathBuf) -> App {
        let settings = Settings::load(&settings_path);
        let client = settings
            .client_path
            .as_ref()
            .and_then(|path| Client::detect(path).ok());

        App {
            settings,
            settings_path,
            cache_path,
            base_url: base_url.into(),
            manifest: None,
            client,
            last_report: None,
            account: None,
            runtimes: if cfg!(windows) {
                Vec::new()
            } else {
                wine::discover()
            },
        }
    }

    /* ----------------------------------------------------------------- *
     * Manifest
     * ----------------------------------------------------------------- */

    pub fn refresh_manifest(&mut self, http: &dyn Http) -> Result<()> {
        let url = format!(
            "{}/api/launcher/manifest",
            self.base_url.trim_end_matches('/')
        );
        let bytes = http.get(&url)?;
        self.manifest = Some(Manifest::parse(&bytes)?);
        Ok(())
    }

    pub fn manifest(&self) -> Option<&Manifest> {
        self.manifest.as_ref()
    }

    /// The address we will actually write, which a local override can replace.
    pub fn realm_address(&self) -> Option<String> {
        self.settings
            .realm_address
            .clone()
            .or_else(|| self.manifest.as_ref().map(|m| m.realm.address.clone()))
    }

    /* ----------------------------------------------------------------- *
     * Client
     * ----------------------------------------------------------------- */

    pub fn choose_client(&mut self, path: impl AsRef<Path>) -> Result<()> {
        let client =
            crate::source::ClientSource::Directory(path.as_ref().to_path_buf()).resolve()?;
        self.settings.client_path = Some(client.root.clone());
        self.client = Some(client);
        // Pointing at a different install invalidates what we knew about the
        // last one; leaving a stale report on screen would be a lie.
        self.last_report = None;
        self.save_settings()
    }

    pub fn client(&self) -> Option<&Client> {
        self.client.as_ref()
    }

    /// Tier 2 and 3. Blocking, long-running; the shell calls it off the UI thread.
    pub fn verify(&mut self, progress: &(dyn Fn(Progress) + Sync)) -> Result<Report> {
        let client = self.client.as_ref().ok_or_else(no_client)?;
        let manifest = self.manifest.as_ref().ok_or_else(no_manifest)?;

        let mut cache = HashCache::load(&self.cache_path);
        let report = verify::verify_client(&client.root, manifest, &mut cache, progress);
        // A cache that fails to save costs the next run some time; it is not
        // worth failing a verification that already succeeded.
        let _ = cache.save(&self.cache_path);

        self.last_report = Some(report.clone());
        Ok(report)
    }

    pub fn last_report(&self) -> Option<&Report> {
        self.last_report.as_ref()
    }

    /* ----------------------------------------------------------------- *
     * Config and patches
     * ----------------------------------------------------------------- */

    /// Write the realmlist, and the account name if we have one.
    pub fn apply_config(&mut self) -> Result<Vec<PathBuf>> {
        let client = self.client.as_ref().ok_or_else(no_client)?;
        let address = self.realm_address().ok_or_else(no_manifest)?;

        let mut written = install::write_realmlist(client, &address)?;
        if let Some(account) = self
            .settings
            .account_name
            .as_deref()
            .filter(|a| !a.is_empty())
        {
            written.push(install::preset_account_name(client, account)?);
        }
        Ok(written)
    }

    /// Fetch and install every patch that is not already correct.
    ///
    /// Only [`crate::manifest::Patch`] entries reach here, and those are the
    /// only manifest entries that can carry a URL at all.
    pub fn install_patches(&mut self, http: &dyn Http) -> Result<Vec<PathBuf>> {
        let client = self.client.as_ref().ok_or_else(no_client)?;
        let manifest = self.manifest.as_ref().ok_or_else(no_manifest)?;

        let outstanding = verify::verify_patches(&client.root, manifest);
        let mut installed = Vec::new();

        for (patch, report) in manifest.patches.iter().zip(outstanding.files.iter()) {
            if report.state.is_match() {
                continue;
            }
            let bytes = http.get(&patch.url)?;
            installed.push(install::install_patch(&client.root, patch, &bytes)?);
        }
        Ok(installed)
    }

    /* ----------------------------------------------------------------- *
     * Account
     * ----------------------------------------------------------------- */

    /// Sign in against the website's account system.
    ///
    /// This does **not** log the player into the game: the client runs its own
    /// SRP6 handshake and there is no supported way to hand it a password. All
    /// this buys is knowing who they are, and pre-filling the name field.
    pub fn login(&mut self, http: &dyn Http, username: &str, password: &str) -> Result<Account> {
        let url = format!(
            "{}/api/launcher/session",
            self.base_url.trim_end_matches('/')
        );
        let body = serde_json::json!({ "username": username, "password": password }).to_string();

        let bytes = http.post_json(&url, &body)?;
        let account: Account = serde_json::from_slice(&bytes)
            .map_err(|e| Error::Message(format!("the realm's reply made no sense: {e}")))?;

        self.settings.account_name = Some(account.username.clone());
        self.save_settings()?;
        self.account = Some(account.clone());
        Ok(account)
    }

    pub fn account(&self) -> Option<&Account> {
        self.account.as_ref()
    }

    /* ----------------------------------------------------------------- *
     * Launch
     * ----------------------------------------------------------------- */

    pub fn runtimes(&self) -> &[Runtime] {
        &self.runtimes
    }

    fn chosen_runtime(&self) -> Option<Runtime> {
        match self.settings.runtime_name.as_deref() {
            Some(name) => self
                .runtimes
                .iter()
                .find(|r| r.name == name)
                .or_else(|| self.runtimes.first())
                .cloned(),
            None => self.runtimes.first().cloned(),
        }
    }

    pub fn launch_plan(&self) -> Result<LaunchPlan> {
        let client = self.client.as_ref().ok_or_else(no_client)?;
        let options = LaunchOptions {
            runtime: self.chosen_runtime(),
            prefix: self.settings.prefix.clone().or_else(wine::default_prefix),
            renderer: self.settings.renderer,
            windowed: self.settings.windowed,
            extra_args: self.settings.extra_args.clone(),
        };
        launch::plan(client, &options, Platform::current())
    }

    /* ----------------------------------------------------------------- *
     * The screen
     * ----------------------------------------------------------------- */

    /// Everything the main view renders, assembled in one place so the UI never
    /// has to decide what a combination of states means.
    pub fn status(&self) -> Status {
        let manifest = self.manifest.as_ref();
        let mut rows = Vec::new();
        let mut blocked = String::new();

        // Client
        match &self.client {
            None => {
                rows.push(row("CLIENT", "not selected", RowState::Block, ""));
                blocked = "choose your World of Warcraft 3.3.5a folder".into();
            }
            Some(client) => {
                let wanted = manifest.map(|m| m.client.build);
                let (state, detail) = match (client.build(), wanted) {
                    (Some(found), Some(want)) if found == want => (RowState::Ok, String::new()),
                    (Some(_), Some(want)) => {
                        blocked = format!(
                            "this client reports {}, and Ashmorrow needs build {want}. \
                             We cannot change that for you — you need a build {want} client.",
                            client
                                .version
                                .map(|v| v.to_string())
                                .unwrap_or_else(|| "an unknown version".into())
                        );
                        (RowState::Block, blocked.clone())
                    }
                    (None, _) => (
                        RowState::Warn,
                        "no version resource in Wow.exe — this may be a repack".into(),
                    ),
                    (Some(_), None) => (RowState::Idle, String::new()),
                };
                rows.push(row(
                    "CLIENT",
                    &client.root.display().to_string(),
                    state,
                    &detail,
                ));

                if let Some(report) = &self.last_report {
                    let state = if report.complete {
                        RowState::Ok
                    } else {
                        RowState::Warn
                    };
                    rows.push(row("FILES", &report.headline(), state, ""));
                }
            }
        }

        // Realmlist
        match self.realm_address() {
            Some(address) => rows.push(row(
                "REALMLIST",
                &format!("set realmlist {address}"),
                if self.client.is_some() {
                    RowState::Ok
                } else {
                    RowState::Idle
                },
                "",
            )),
            None => {
                rows.push(row(
                    "REALMLIST",
                    "waiting for the realm",
                    RowState::Busy,
                    "",
                ));
                if blocked.is_empty() {
                    blocked = "could not reach the realm for its configuration".into();
                }
            }
        }

        // Patches
        let patch_count = manifest.map(|m| m.patches.len()).unwrap_or(0);
        rows.push(row(
            "PATCH",
            if patch_count == 0 {
                "none required"
            } else {
                "update available"
            },
            if patch_count == 0 {
                RowState::Ok
            } else {
                RowState::Warn
            },
            "",
        ));

        // Account
        match &self.account {
            Some(account) => rows.push(row(
                "ACCOUNT",
                &format!("{} · {} characters", account.username, account.characters),
                RowState::Ok,
                "",
            )),
            None => rows.push(row("ACCOUNT", "not signed in", RowState::Idle, "optional")),
        }

        let runtime = if cfg!(windows) {
            "native".to_string()
        } else {
            match self.chosen_runtime() {
                Some(runtime) => runtime.name,
                None => {
                    if blocked.is_empty() {
                        blocked =
                            "no Wine or Proton found — install Wine from your distribution".into();
                    }
                    "none".into()
                }
            }
        };

        let can_launch = blocked.is_empty() && self.client.is_some();
        let action = if self.client.is_none() {
            "SELECT CLIENT"
        } else if !blocked.is_empty() {
            "BLOCKED"
        } else if self.last_report.is_none() {
            "VERIFY"
        } else if patch_count > 0 {
            "INSTALL PATCH"
        } else {
            "LAUNCH"
        };

        Status {
            realm: manifest
                .map(|m| m.realm.name.clone())
                .unwrap_or_else(|| "Ashmorrow".into()),
            realm_address: self.realm_address().unwrap_or_default(),
            client_version: self
                .client
                .as_ref()
                .and_then(|c| c.version)
                .map(|v| v.to_string())
                .unwrap_or_else(|| "—".into()),
            patch_level: manifest.map(|m| m.patch_level()).unwrap_or(0),
            runtime,
            rows,
            action: action.into(),
            can_launch,
            blocked_because: blocked,
        }
    }

    pub fn save_settings(&self) -> Result<()> {
        self.settings.save(&self.settings_path)
    }
}

fn row(key: &str, value: &str, state: RowState, detail: &str) -> Row {
    Row {
        key: key.into(),
        value: value.into(),
        state,
        detail: detail.into(),
    }
}

fn no_client() -> Error {
    Error::Message("no client selected yet".into())
}

fn no_manifest() -> Error {
    Error::Message("the realm's configuration has not been loaded yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    const HASH_OF_HELLO: &str = "ea8f163db38682925e4491c5e58d4bb3506ef8c14eb78a86e908c5624a67200f";

    struct FakeHttp {
        responses: HashMap<String, Vec<u8>>,
        requested: Mutex<Vec<String>>,
    }

    impl FakeHttp {
        fn new(pairs: &[(&str, &str)]) -> FakeHttp {
            FakeHttp {
                responses: pairs
                    .iter()
                    .map(|(url, body)| ((*url).to_string(), body.as_bytes().to_vec()))
                    .collect(),
                requested: Mutex::new(Vec::new()),
            }
        }
    }

    impl Http for FakeHttp {
        fn get(&self, url: &str) -> Result<Vec<u8>> {
            self.requested.lock().unwrap().push(url.to_string());
            self.responses
                .get(url)
                .cloned()
                .ok_or_else(|| Error::Message(format!("no fake response for {url}")))
        }
        fn post_json(&self, url: &str, _body: &str) -> Result<Vec<u8>> {
            self.get(url)
        }
    }

    fn manifest_json() -> String {
        format!(
            r#"{{"schema":1,
                 "realm":{{"name":"Ashmorrow","address":"play.ashmorrow.example"}},
                 "client":{{"build":12340,"version":"3.3.5",
                            "files":[{{"path":"Data/common.MPQ","size":5,"hash":"{HASH_OF_HELLO}"}}]}}}}"#
        )
    }

    fn wotlk_exe() -> Vec<u8> {
        let mut bytes = vec![0x11; 16];
        bytes.extend_from_slice(&[0xBD, 0x04, 0xEF, 0xFE]);
        bytes.extend_from_slice(&0x0001_0000u32.to_le_bytes());
        bytes.extend_from_slice(&((3u32 << 16) | 3).to_le_bytes());
        bytes.extend_from_slice(&((5u32 << 16) | 12340).to_le_bytes());
        bytes
    }

    fn fake_client(root: &Path) {
        std::fs::create_dir_all(root.join("Data/enUS")).unwrap();
        std::fs::write(root.join("Wow.exe"), wotlk_exe()).unwrap();
        std::fs::write(root.join("Data/common.MPQ"), b"hello").unwrap();
    }

    fn app_in(dir: &Path) -> App {
        App::new(
            "https://ashmorrow.example",
            dir.join("settings.json"),
            dir.join("hashes.json"),
        )
    }

    #[test]
    fn with_nothing_chosen_the_button_asks_for_a_client() {
        let dir = tempfile::tempdir().unwrap();
        let status = app_in(dir.path()).status();
        assert_eq!(status.action, "SELECT CLIENT");
        assert!(!status.can_launch);
    }

    #[test]
    fn a_full_pass_ends_with_a_launchable_status() {
        let dir = tempfile::tempdir().unwrap();
        let client_dir = dir.path().join("wow");
        fake_client(&client_dir);

        let http = FakeHttp::new(&[(
            "https://ashmorrow.example/api/launcher/manifest",
            &manifest_json(),
        )]);

        let mut app = app_in(dir.path());
        app.refresh_manifest(&http).unwrap();
        app.choose_client(&client_dir).unwrap();

        let report = app.verify(&|_| {}).unwrap();
        assert!(report.complete, "{}", report.headline());

        let written = app.apply_config().unwrap();
        assert_eq!(
            std::fs::read_to_string(&written[0]).unwrap(),
            "set realmlist play.ashmorrow.example\n"
        );

        let status = app.status();
        assert_eq!(status.realm, "Ashmorrow");
        assert_eq!(status.client_version, "3.3.5.12340");
        assert_eq!(status.patch_level, 0);
        assert!(status
            .rows
            .iter()
            .any(|r| r.key == "PATCH" && r.value == "none required"));
    }

    #[test]
    fn a_wrong_build_blocks_and_the_reason_says_we_cannot_fix_it() {
        let dir = tempfile::tempdir().unwrap();
        let client_dir = dir.path().join("wow");
        std::fs::create_dir_all(client_dir.join("Data/enUS")).unwrap();
        let mut exe = vec![0x11; 8];
        exe.extend_from_slice(&[0xBD, 0x04, 0xEF, 0xFE]);
        exe.extend_from_slice(&0x0001_0000u32.to_le_bytes());
        exe.extend_from_slice(&((2u32 << 16) | 4).to_le_bytes());
        exe.extend_from_slice(&((3u32 << 16) | 8606).to_le_bytes());
        std::fs::write(client_dir.join("Wow.exe"), exe).unwrap();

        let http = FakeHttp::new(&[(
            "https://ashmorrow.example/api/launcher/manifest",
            &manifest_json(),
        )]);

        let mut app = app_in(dir.path());
        app.refresh_manifest(&http).unwrap();
        app.choose_client(&client_dir).unwrap();

        let status = app.status();
        assert!(!status.can_launch);
        assert_eq!(status.action, "BLOCKED");
        assert!(status.blocked_because.contains("2.4.3.8606"));
        assert!(
            status
                .blocked_because
                .contains("cannot change that for you"),
            "the message must be honest about what we can and cannot do: {}",
            status.blocked_because
        );
    }

    #[test]
    fn choosing_a_new_client_forgets_the_previous_verification() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        fake_client(&first);
        fake_client(&second);

        let http = FakeHttp::new(&[(
            "https://ashmorrow.example/api/launcher/manifest",
            &manifest_json(),
        )]);

        let mut app = app_in(dir.path());
        app.refresh_manifest(&http).unwrap();
        app.choose_client(&first).unwrap();
        app.verify(&|_| {}).unwrap();
        assert!(app.last_report().is_some());

        app.choose_client(&second).unwrap();
        assert!(
            app.last_report().is_none(),
            "a report about a different install must not survive"
        );
    }

    #[test]
    fn the_chosen_client_is_remembered_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let client_dir = dir.path().join("wow");
        fake_client(&client_dir);

        app_in(dir.path()).choose_client(&client_dir).unwrap();

        let restarted = app_in(dir.path());
        assert_eq!(restarted.client().map(|c| c.root.clone()), Some(client_dir));
    }

    #[test]
    fn a_local_realm_override_wins_over_the_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let http = FakeHttp::new(&[(
            "https://ashmorrow.example/api/launcher/manifest",
            &manifest_json(),
        )]);

        let mut app = app_in(dir.path());
        app.refresh_manifest(&http).unwrap();
        assert_eq!(
            app.realm_address().as_deref(),
            Some("play.ashmorrow.example")
        );

        app.settings.realm_address = Some("192.168.1.50".into());
        assert_eq!(app.realm_address().as_deref(), Some("192.168.1.50"));
    }

    #[test]
    fn signing_in_remembers_the_name_and_never_the_password() {
        let dir = tempfile::tempdir().unwrap();
        let http = FakeHttp::new(&[(
            "https://ashmorrow.example/api/launcher/session",
            r#"{"username":"ashadmin","characters":2,"token":"short-lived"}"#,
        )]);

        let mut app = app_in(dir.path());
        let account = app.login(&http, "ashadmin", "hunter2").unwrap();
        assert_eq!(account.username, "ashadmin");

        let saved = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(saved.contains("ashadmin"));
        assert!(
            !saved.contains("hunter2") && !saved.contains("short-lived"),
            "neither the password nor the token belongs on disk: {saved}"
        );
    }

    #[test]
    fn patches_are_only_fetched_when_they_are_actually_missing() {
        let dir = tempfile::tempdir().unwrap();
        let client_dir = dir.path().join("wow");
        fake_client(&client_dir);

        let patch_bytes = b"our own patch";
        let patch_hash = blake3::hash(patch_bytes).to_hex().to_string();
        let manifest = format!(
            r#"{{"schema":1,
                 "realm":{{"name":"Ashmorrow","address":"play.ashmorrow.example"}},
                 "client":{{"build":12340,"version":"3.3.5"}},
                 "patches":[{{"id":"ash-base","version":3,"path":"Data/patch-4.MPQ",
                              "size":{},"hash":"{patch_hash}",
                              "url":"https://patches.ashmorrow.example/base.mpq"}}]}}"#,
            patch_bytes.len()
        );

        let http = FakeHttp::new(&[
            ("https://ashmorrow.example/api/launcher/manifest", &manifest),
            (
                "https://patches.ashmorrow.example/base.mpq",
                std::str::from_utf8(patch_bytes).unwrap(),
            ),
        ]);

        let mut app = app_in(dir.path());
        app.refresh_manifest(&http).unwrap();
        app.choose_client(&client_dir).unwrap();
        assert_eq!(app.status().patch_level, 3);

        let installed = app.install_patches(&http).unwrap();
        assert_eq!(installed.len(), 1);
        assert_eq!(std::fs::read(&installed[0]).unwrap(), patch_bytes);

        // Second pass: already correct, so nothing is fetched again.
        let before = http.requested.lock().unwrap().len();
        assert!(app.install_patches(&http).unwrap().is_empty());
        assert_eq!(http.requested.lock().unwrap().len(), before);
    }
}
