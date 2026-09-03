//! Finding a Wine or Proton to run a Windows client with.
//!
//! We detect and instruct; we never install. Bundling Wine would mean shipping
//! someone else's build, keeping it patched, and owning the bug reports when it
//! behaves differently from the one their distribution ships.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind {
    Wine,
    Proton,
}

/// One way of running a Windows executable on this machine.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Runtime {
    pub kind: RuntimeKind,
    /// What the player sees: "Wine (system)", "Proton 9.0".
    pub name: String,
    pub program: PathBuf,
    /// Proton needs to be told where Steam itself is.
    pub steam_root: Option<PathBuf>,
}

/// Everything runnable we can find, best first.
///
/// Proton is listed after system Wine because Proton carries Steam's own
/// assumptions about being launched by Steam, and a plain `wine` is the fewer
/// moving parts of the two for a fifteen-year-old DirectX 9 game.
pub fn discover() -> Vec<Runtime> {
    let mut found = Vec::new();
    if let Some(program) = which("wine") {
        found.push(Runtime {
            kind: RuntimeKind::Wine,
            name: "Wine (system)".into(),
            program,
            steam_root: None,
        });
    }
    for root in steam_roots() {
        found.extend(protons_under(&root));
    }
    found
}

/// Steam installs itself in one of a handful of places, and the Flatpak build
/// somewhere else again.
pub fn steam_roots() -> Vec<PathBuf> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    [
        ".steam/steam",
        ".local/share/Steam",
        ".steam/root",
        ".var/app/com.valvesoftware.Steam/data/Steam",
    ]
    .iter()
    .map(|suffix| home.join(suffix))
    .filter(|path| path.is_dir())
    .collect()
}

fn protons_under(steam_root: &Path) -> Vec<Runtime> {
    let mut libraries = vec![steam_root.to_path_buf()];
    let vdf = steam_root.join("steamapps/libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(&vdf) {
        libraries.extend(parse_library_folders(&text));
    }
    libraries.sort();
    libraries.dedup();

    let mut found = Vec::new();
    for library in libraries {
        let common = library.join("steamapps/common");
        let Ok(entries) = std::fs::read_dir(&common) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("Proton") {
                continue;
            }
            let program = entry.path().join("proton");
            if program.is_file() {
                found.push(Runtime {
                    kind: RuntimeKind::Proton,
                    name,
                    program,
                    steam_root: Some(steam_root.to_path_buf()),
                });
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// Pull the `"path"` values out of Steam's `libraryfolders.vdf`.
///
/// Written by hand rather than with a VDF parser: we need exactly one key, the
/// format has been stable for a decade, and a dependency that parses a config
/// language is a dependency that parses attacker-adjacent input.
pub fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|line| {
            let mut quoted = line.split('"').skip(1).step_by(2);
            let key = quoted.next()?;
            if !key.eq_ignore_ascii_case("path") {
                return None;
            }
            let value = quoted.next()?;
            // VDF escapes backslashes; Linux paths have none, but a Windows
            // library entry copied into a Linux install does.
            Some(PathBuf::from(value.replace("\\\\", "\\")))
        })
        .filter(|path| path.is_absolute())
        .collect()
}

/// The prefix the launcher manages for itself.
///
/// Deliberately not `~/.wine`: sharing the default prefix with everything else
/// the player runs means our DLL overrides and their other games' overrides are
/// the same setting, and "the launcher broke my other games" is not a failure
/// mode worth having.
pub fn default_prefix() -> Option<PathBuf> {
    Some(data_dir()?.join("ashmorrow").join("prefix"))
}

pub fn data_dir() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(xdg));
    }
    Some(home_dir()?.join(".local/share"))
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// `which`, without shelling out to it.
fn which(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VDF: &str = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"/home/player/.local/share/Steam"
		"label"		""
		"contentid"		"123"
	}
	"1"
	{
		"path"		"/mnt/games/SteamLibrary"
		"totalsize"		"2000398934016"
	}
}
"#;

    /// Unix-only, and deliberately so: `discover()` returns early on Windows,
    /// so Steam library parsing never runs there and Unix path semantics are
    /// the only ones that matter. `Path::is_absolute` disagrees across
    /// platforms — `/home/player` is not absolute to Windows, which has no
    /// drive letter to anchor it — and asserting otherwise would be asserting
    /// about a code path that cannot execute.
    #[cfg(unix)]
    #[test]
    fn reads_every_library_path_and_nothing_else() {
        let paths = parse_library_folders(VDF);
        assert_eq!(
            paths,
            [
                PathBuf::from("/home/player/.local/share/Steam"),
                PathBuf::from("/mnt/games/SteamLibrary"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn ignores_relative_and_malformed_entries() {
        let vdf = "\t\"path\"\t\t\"not/absolute\"\n\t\"label\"\t\t\"/absolute/but/not/a/path/key\"\n\"path\"\n";
        assert!(parse_library_folders(vdf).is_empty());
    }

    #[test]
    fn finds_a_proton_in_a_library_listed_by_the_vdf() {
        let dir = tempfile::tempdir().unwrap();
        let steam = dir.path().join("steam");
        let library = dir.path().join("library");
        std::fs::create_dir_all(steam.join("steamapps")).unwrap();

        let proton = library.join("steamapps/common/Proton 9.0 (Beta)");
        std::fs::create_dir_all(&proton).unwrap();
        std::fs::write(proton.join("proton"), "#!/usr/bin/env python3\n").unwrap();

        std::fs::write(
            steam.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
                library.display()
            ),
        )
        .unwrap();

        let found = protons_under(&steam);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, RuntimeKind::Proton);
        assert_eq!(found[0].name, "Proton 9.0 (Beta)");
        assert_eq!(found[0].steam_root.as_deref(), Some(steam.as_path()));
    }

    #[test]
    fn a_proton_directory_with_no_proton_script_is_not_a_runtime() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("steamapps/common/Proton 8.0")).unwrap();
        assert!(protons_under(dir.path()).is_empty());
    }
}
