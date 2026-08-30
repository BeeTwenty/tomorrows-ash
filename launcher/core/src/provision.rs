//! Building a Wine prefix the game will actually run in.
//!
//! Detecting Wine and then telling a player to configure a prefix, find DXVK,
//! unpack it into the right one of two system directories and set DLL
//! overrides is not a launcher — it is a README with a progress bar. This
//! module does that work.
//!
//! What it installs is **free software that is not ours and not Blizzard's**:
//! DXVK is zlib-licensed and freely redistributable. Everything arrives with an
//! `https` URL and a hash checked before a byte is written, exactly like our own
//! patches. Nothing here ever touches the game directory — it all goes into the
//! prefix the launcher owns.
//!
//! Wine itself is still not installed by us. It belongs to the distribution's
//! package manager, and a launcher that installs system packages behind a
//! player's back has overstepped.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoContext, Result};
use crate::manifest::{ComponentKind, RuntimeComponent};
use crate::wine::{Runtime, RuntimeKind};

/// WoW 3.3.5a is a 32-bit Direct3D 9 executable, so this is the only DLL that
/// matters. Installing the D3D10/11 and DXGI ones too would be cargo cult.
const DXVK_DLLS: &[&str] = &["d3d9.dll"];

/// How the prefix is set up right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrefixState {
    pub path: PathBuf,
    /// `drive_c` exists — something has run `wineboot` here.
    pub initialised: bool,
    /// A 64-bit prefix has both system32 and syswow64.
    pub win64: bool,
    /// Component ids whose files are present and match.
    pub installed: Vec<String>,
}

impl PrefixState {
    pub fn read(prefix: &Path) -> PrefixState {
        let drive_c = prefix.join("drive_c");
        let system32 = drive_c.join("windows/system32");
        let syswow64 = drive_c.join("windows/syswow64");

        PrefixState {
            initialised: drive_c.is_dir(),
            win64: syswow64.is_dir(),
            installed: Vec::new(),
            path: prefix.to_path_buf(),
        }
        .with_installed(&system32, &syswow64)
    }

    fn with_installed(mut self, system32: &Path, syswow64: &Path) -> PrefixState {
        // Where a 32-bit DLL lives depends on the prefix's architecture, and
        // getting it wrong is the classic "DXVK did nothing" bug.
        let target = if self.win64 { syswow64 } else { system32 };
        if DXVK_DLLS.iter().all(|dll| target.join(dll).is_file()) {
            self.installed.push("dxvk".into());
        }
        self
    }

    pub fn has(&self, id: &str) -> bool {
        self.installed.iter().any(|got| got == id)
    }

    /// Where a 32-bit DLL belongs in this prefix.
    pub fn system_dir_32(&self) -> PathBuf {
        self.path.join(if self.win64 {
            "drive_c/windows/syswow64"
        } else {
            "drive_c/windows/system32"
        })
    }
}

/// A command to run against a prefix, as data, so the caller can show it and
/// the tests can assert on it without a Wine installation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrefixCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub description: &'static str,
}

impl PrefixCommand {
    pub fn command(&self) -> std::process::Command {
        let mut command = std::process::Command::new(&self.program);
        command.args(&self.args);
        for (key, value) in &self.env {
            command.env(key, value);
        }
        command
    }
}

fn prefix_env(runtime: &Runtime, prefix: &Path) -> Vec<(String, String)> {
    let mut env = vec![("WINEDEBUG".into(), "-all".into())];
    match runtime.kind {
        RuntimeKind::Wine => {
            env.push(("WINEPREFIX".into(), prefix.to_string_lossy().into_owned()));
        }
        RuntimeKind::Proton => {
            env.push((
                "STEAM_COMPAT_DATA_PATH".into(),
                prefix.to_string_lossy().into_owned(),
            ));
            if let Some(steam) = &runtime.steam_root {
                env.push((
                    "STEAM_COMPAT_CLIENT_INSTALL_PATH".into(),
                    steam.to_string_lossy().into_owned(),
                ));
            }
        }
    }
    env
}

/// The command that creates and initialises an empty prefix.
///
/// `wineboot -u` is the update form: safe to run against a prefix that already
/// exists, which makes "repair my prefix" the same code path as "create it".
pub fn initialise(runtime: &Runtime, prefix: &Path) -> PrefixCommand {
    let mut args = Vec::new();
    if runtime.kind == RuntimeKind::Proton {
        args.push("run".to_string());
        args.push("wineboot".to_string());
    } else {
        args.push("wineboot".to_string());
    }
    args.push("-u".into());

    PrefixCommand {
        program: runtime.program.clone(),
        args,
        env: prefix_env(runtime, prefix),
        description: "creating the Wine prefix",
    }
}

/// The command that applies a `.reg` file written by [`dll_override_reg`].
pub fn apply_registry(runtime: &Runtime, prefix: &Path, reg: &Path) -> PrefixCommand {
    let mut args = Vec::new();
    if runtime.kind == RuntimeKind::Proton {
        args.push("run".to_string());
    }
    args.push("regedit".into());
    args.push(reg.to_string_lossy().into_owned());

    PrefixCommand {
        program: runtime.program.clone(),
        args,
        env: prefix_env(runtime, prefix),
        description: "telling Wine to prefer the installed DLLs",
    }
}

/// A `.reg` file that makes Wine load our DLLs instead of its own.
///
/// Written as a file and applied with `regedit` rather than by editing
/// `user.reg` directly: the on-disk format is Wine's business, and a prefix
/// with a hand-mangled registry is a support case nobody can debug.
pub fn dll_override_reg(dlls: &[&str]) -> String {
    let mut out = String::from("REGEDIT4\n\n[HKEY_CURRENT_USER\\Software\\Wine\\DllOverrides]\n");
    for dll in dlls {
        // The override key is the module name without its extension.
        let name = dll.strip_suffix(".dll").unwrap_or(dll);
        out.push_str(&format!("\"{name}\"=\"native,builtin\"\n"));
    }
    out
}

/// Unpack a DXVK release tarball into a prefix.
///
/// Returns the files written. The archive is `dxvk-<version>/x32/*.dll` and
/// `.../x64/*.dll`; we take the 32-bit set, because the game is 32-bit.
pub fn install_dxvk(tarball: &[u8], state: &PrefixState) -> Result<Vec<PathBuf>> {
    let target = state.system_dir_32();
    std::fs::create_dir_all(&target).at(&target)?;

    let decoder = flate2::read::GzDecoder::new(tarball);
    let mut archive = tar::Archive::new(decoder);
    let mut written = Vec::new();

    let entries = archive
        .entries()
        .map_err(|e| Error::Message(format!("the DXVK archive could not be read: {e}")))?;

    for entry in entries {
        let mut entry =
            entry.map_err(|e| Error::Message(format!("the DXVK archive is damaged: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| Error::Message(format!("the DXVK archive has an odd path: {e}")))?
            .into_owned();

        // Match on the trailing `x32/<name>.dll`, so the version-numbered top
        // directory does not have to be guessed.
        let components: Vec<String> = path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        let [.., arch, name] = components.as_slice() else {
            continue;
        };
        if arch != "x32" || !DXVK_DLLS.contains(&name.as_str()) {
            continue;
        }

        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| {
            Error::Message(format!("{name} could not be read from the archive: {e}"))
        })?;

        let destination = target.join(name);
        // Write beside and rename, so an interrupted install cannot leave a
        // half-written DLL that Wine will happily try to load.
        let temporary = destination.with_extension("ashmorrow-part");
        std::fs::write(&temporary, &bytes).at(&temporary)?;
        std::fs::rename(&temporary, &destination).at(&destination)?;
        written.push(destination);
    }

    if written.is_empty() {
        return Err(Error::Message(
            "the DXVK archive contained no 32-bit d3d9.dll — is it a DXVK release?".into(),
        ));
    }
    Ok(written)
}

/// Dispatch on component kind. One arm today; the shape is what matters.
pub fn install_component(
    component: &RuntimeComponent,
    bytes: &[u8],
    state: &PrefixState,
) -> Result<Vec<PathBuf>> {
    let found = blake3::hash(bytes).to_hex().to_string();
    if !found.eq_ignore_ascii_case(&component.hash) {
        return Err(Error::Message(format!(
            "{} does not match its published hash — expected {}, got {found}. Nothing was written.",
            component.id, component.hash
        )));
    }
    if bytes.len() as u64 != component.size {
        return Err(Error::Message(format!(
            "{} is {} bytes, the manifest says {}. Nothing was written.",
            component.id,
            bytes.len(),
            component.size
        )));
    }

    match component.kind {
        ComponentKind::Dxvk => install_dxvk(bytes, state),
    }
}

/// The DLLs a component wants overridden once it is installed.
pub fn overrides_for(kind: ComponentKind) -> &'static [&'static str] {
    match kind {
        ComponentKind::Dxvk => DXVK_DLLS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn prefix_with(win64: bool) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("drive_c/windows/system32")).unwrap();
        if win64 {
            std::fs::create_dir_all(dir.path().join("drive_c/windows/syswow64")).unwrap();
        }
        dir
    }

    /// A tarball shaped like a real DXVK release.
    fn dxvk_tarball(version: &str) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        for (arch, body) in [("x32", b"32-bit d3d9".as_slice()), ("x64", b"64-bit d3d9")] {
            for name in ["d3d9.dll", "dxgi.dll"] {
                let mut header = tar::Header::new_gnu();
                header.set_size(body.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                tar.append_data(&mut header, format!("dxvk-{version}/{arch}/{name}"), body)
                    .unwrap();
            }
        }
        let raw = tar.into_inner().unwrap();
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&raw).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn an_empty_directory_is_an_uninitialised_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let state = PrefixState::read(dir.path());
        assert!(!state.initialised);
        assert!(!state.has("dxvk"));
    }

    #[test]
    fn a_32_bit_dll_goes_to_syswow64_in_a_64_bit_prefix() {
        let dir = prefix_with(true);
        let state = PrefixState::read(dir.path());
        assert!(state.initialised);
        assert!(state.win64);
        assert!(state.system_dir_32().ends_with("syswow64"));
    }

    #[test]
    fn a_32_bit_dll_goes_to_system32_in_a_32_bit_prefix() {
        let dir = prefix_with(false);
        let state = PrefixState::read(dir.path());
        assert!(!state.win64);
        assert!(state.system_dir_32().ends_with("system32"));
    }

    #[test]
    fn installs_the_32_bit_dll_and_leaves_the_64_bit_one_alone() {
        let dir = prefix_with(true);
        let state = PrefixState::read(dir.path());

        let written = install_dxvk(&dxvk_tarball("2.4.1"), &state).unwrap();
        assert_eq!(written.len(), 1);
        assert!(written[0].ends_with("syswow64/d3d9.dll"));
        assert_eq!(std::fs::read(&written[0]).unwrap(), b"32-bit d3d9");

        // Not dxgi: the game is D3D9 and installing more is cargo cult.
        assert!(!dir
            .path()
            .join("drive_c/windows/syswow64/dxgi.dll")
            .exists());
        // And nothing landed in system32, which is the classic silent failure.
        assert!(!dir
            .path()
            .join("drive_c/windows/system32/d3d9.dll")
            .exists());
    }

    #[test]
    fn a_freshly_installed_prefix_reports_the_component_as_present() {
        let dir = prefix_with(true);
        install_dxvk(&dxvk_tarball("2.4.1"), &PrefixState::read(dir.path())).unwrap();
        assert!(PrefixState::read(dir.path()).has("dxvk"));
    }

    #[test]
    fn the_version_in_the_archive_directory_does_not_have_to_be_known() {
        let dir = prefix_with(false);
        let state = PrefixState::read(dir.path());
        assert_eq!(
            install_dxvk(&dxvk_tarball("9.9.9-beta"), &state)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn an_archive_that_is_not_dxvk_is_refused_rather_than_half_applied() {
        let dir = prefix_with(true);
        let state = PrefixState::read(dir.path());

        let mut tar = tar::Builder::new(Vec::new());
        let body = b"not a dll";
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, "something/else/readme.txt", body.as_slice())
            .unwrap();
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&tar.into_inner().unwrap()).unwrap();

        let error = install_dxvk(&encoder.finish().unwrap(), &state).unwrap_err();
        assert!(error.to_string().contains("DXVK release"), "{error}");
        assert!(!state.system_dir_32().join("d3d9.dll").exists());
    }

    #[test]
    fn a_component_whose_bytes_do_not_match_writes_nothing() {
        let dir = prefix_with(true);
        let state = PrefixState::read(dir.path());
        let component = RuntimeComponent {
            id: "dxvk".into(),
            kind: ComponentKind::Dxvk,
            version: "2.4.1".into(),
            size: 10,
            hash: blake3::hash(b"the real thing").to_hex().to_string(),
            url: "https://example.invalid/dxvk.tar.gz".into(),
            licence: "Zlib".into(),
            summary: String::new(),
        };

        let error = install_component(&component, b"tampered!!", &state).unwrap_err();
        assert!(error.to_string().contains("Nothing was written"), "{error}");
        assert!(!state.system_dir_32().join("d3d9.dll").exists());
    }

    #[test]
    fn the_override_file_names_modules_without_their_extension() {
        let reg = dll_override_reg(&["d3d9.dll"]);
        assert!(reg.starts_with("REGEDIT4"));
        assert!(reg.contains(r#""d3d9"="native,builtin""#));
        assert!(!reg.contains("d3d9.dll"));
    }

    fn wine() -> Runtime {
        Runtime {
            kind: RuntimeKind::Wine,
            name: "Wine (system)".into(),
            program: PathBuf::from("/usr/bin/wine"),
            steam_root: None,
        }
    }

    #[test]
    fn initialising_a_wine_prefix_sets_wineprefix_and_runs_wineboot() {
        let command = initialise(&wine(), Path::new("/data/prefix"));
        assert_eq!(command.args, ["wineboot", "-u"]);
        assert!(command
            .env
            .contains(&("WINEPREFIX".into(), "/data/prefix".into())));
    }

    #[test]
    fn initialising_a_proton_prefix_goes_through_run_with_the_compat_variables() {
        let runtime = Runtime {
            kind: RuntimeKind::Proton,
            name: "Proton 9.0".into(),
            program: PathBuf::from("/steam/common/Proton 9.0/proton"),
            steam_root: Some(PathBuf::from("/steam")),
        };
        let command = initialise(&runtime, Path::new("/data/prefix"));
        assert_eq!(command.args, ["run", "wineboot", "-u"]);
        let keys: Vec<&str> = command.env.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"STEAM_COMPAT_DATA_PATH"));
        assert!(keys.contains(&"STEAM_COMPAT_CLIENT_INSTALL_PATH"));
    }

    #[test]
    fn applying_the_registry_passes_the_file_to_regedit() {
        let command = apply_registry(&wine(), Path::new("/data/prefix"), Path::new("/tmp/o.reg"));
        assert_eq!(command.args, ["regedit", "/tmp/o.reg"]);
    }
}
