//! Working out the exact command that starts the game.
//!
//! Building the command and running it are separate on purpose: the plan is
//! plain data, so the launcher can show a player the literal command line it is
//! about to run, and so both platforms' paths are testable from one machine.

use std::path::PathBuf;

use crate::client::Client;
use crate::error::{Error, Result};
use crate::wine::{Runtime, RuntimeKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Renderer {
    /// The client's own Direct3D 9 path. Through DXVK on Linux if it is present.
    #[default]
    Direct3D,
    /// The client's OpenGL path. Worth trying when D3D9 misbehaves under Wine.
    OpenGl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Unix,
}

impl Platform {
    pub const fn current() -> Platform {
        if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Unix
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct LaunchOptions {
    /// Ignored on Windows, required on anything else.
    pub runtime: Option<Runtime>,
    pub prefix: Option<PathBuf>,
    pub renderer: Renderer,
    pub windowed: bool,
    /// Anything the player added by hand.
    pub extra_args: Vec<String>,
}

/// A command, as data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub working_directory: PathBuf,
}

impl LaunchPlan {
    /// The command line, quoted enough to be read by a human in a bug report.
    pub fn display(&self) -> String {
        let quote = |s: &str| {
            if s.contains(' ') {
                format!("\"{s}\"")
            } else {
                s.to_string()
            }
        };
        let mut parts: Vec<String> = self
            .env
            .iter()
            .map(|(k, v)| format!("{k}={}", quote(v)))
            .collect();
        parts.push(quote(&self.program.to_string_lossy()));
        parts.extend(self.args.iter().map(|a| quote(a)));
        parts.join(" ")
    }

    pub fn command(&self) -> std::process::Command {
        let mut command = std::process::Command::new(&self.program);
        command.args(&self.args);
        command.current_dir(&self.working_directory);
        for (key, value) in &self.env {
            command.env(key, value);
        }
        command
    }
}

/// Client-side switches, shared by every platform.
fn client_args(options: &LaunchOptions) -> Vec<String> {
    let mut args = Vec::new();
    if options.renderer == Renderer::OpenGl {
        args.push("-opengl".into());
    }
    if options.windowed {
        args.push("-windowed".into());
    }
    args.extend(options.extra_args.iter().cloned());
    args
}

/// Build the command that starts `client`.
pub fn plan(client: &Client, options: &LaunchOptions, platform: Platform) -> Result<LaunchPlan> {
    // The client resolves its data paths relative to the working directory, so
    // this is not a detail — starting it from anywhere else fails obscurely.
    let working_directory = client.root.clone();
    let game_args = client_args(options);

    if platform == Platform::Windows {
        return Ok(LaunchPlan {
            program: client.executable.clone(),
            args: game_args,
            env: Vec::new(),
            working_directory,
        });
    }

    let runtime = options.runtime.as_ref().ok_or(Error::NoWine)?;
    let executable = client.executable.to_string_lossy().into_owned();
    let mut env: Vec<(String, String)> = Vec::new();
    let mut args: Vec<String> = Vec::new();

    match runtime.kind {
        RuntimeKind::Wine => {
            if let Some(prefix) = &options.prefix {
                env.push(("WINEPREFIX".into(), prefix.to_string_lossy().into_owned()));
            }
            // Wine's own chatter is not a player-facing diagnostic and drowns
            // out the lines that are.
            env.push(("WINEDEBUG".into(), "-all".into()));
            args.push(executable);
        }
        RuntimeKind::Proton => {
            // Proton refuses to start without both of these, and the error it
            // gives when they are missing names neither of them.
            let prefix = options
                .prefix
                .as_ref()
                .ok_or_else(|| Error::Message("Proton needs a compatibility data path".into()))?;
            let steam_root = runtime.steam_root.as_ref().ok_or_else(|| {
                Error::Message("Proton needs to be told where Steam is installed".into())
            })?;
            env.push((
                "STEAM_COMPAT_DATA_PATH".into(),
                prefix.to_string_lossy().into_owned(),
            ));
            env.push((
                "STEAM_COMPAT_CLIENT_INSTALL_PATH".into(),
                steam_root.to_string_lossy().into_owned(),
            ));
            args.push("run".into());
            args.push(executable);
        }
    }

    args.extend(game_args);

    Ok(LaunchPlan {
        program: runtime.program.clone(),
        args,
        env,
        working_directory,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn client() -> Client {
        Client {
            root: PathBuf::from("/games/wow"),
            executable: PathBuf::from("/games/wow/Wow.exe"),
            version: None,
            locales: vec!["enUS".into()],
        }
    }

    fn wine() -> Runtime {
        Runtime {
            kind: RuntimeKind::Wine,
            name: "Wine (system)".into(),
            program: PathBuf::from("/usr/bin/wine"),
            steam_root: None,
        }
    }

    fn proton() -> Runtime {
        Runtime {
            kind: RuntimeKind::Proton,
            name: "Proton 9.0".into(),
            program: PathBuf::from("/steam/steamapps/common/Proton 9.0/proton"),
            steam_root: Some(PathBuf::from("/steam")),
        }
    }

    #[test]
    fn on_windows_it_runs_the_executable_from_the_client_directory() {
        let plan = plan(&client(), &LaunchOptions::default(), Platform::Windows).unwrap();
        assert_eq!(plan.program, Path::new("/games/wow/Wow.exe"));
        assert_eq!(plan.working_directory, Path::new("/games/wow"));
        assert!(plan.args.is_empty());
        assert!(plan.env.is_empty());
    }

    #[test]
    fn wine_gets_the_prefix_and_the_executable_as_an_argument() {
        let options = LaunchOptions {
            runtime: Some(wine()),
            prefix: Some(PathBuf::from("/home/p/.local/share/ashmorrow/prefix")),
            renderer: Renderer::OpenGl,
            windowed: true,
            extra_args: vec!["-console".into()],
        };
        let plan = plan(&client(), &options, Platform::Unix).unwrap();

        assert_eq!(plan.program, Path::new("/usr/bin/wine"));
        assert_eq!(
            plan.args,
            ["/games/wow/Wow.exe", "-opengl", "-windowed", "-console"]
        );
        assert!(plan.env.contains(&(
            "WINEPREFIX".into(),
            "/home/p/.local/share/ashmorrow/prefix".into()
        )));
    }

    #[test]
    fn proton_is_invoked_through_run_with_both_compat_variables() {
        let options = LaunchOptions {
            runtime: Some(proton()),
            prefix: Some(PathBuf::from("/data/prefix")),
            ..LaunchOptions::default()
        };
        let plan = plan(&client(), &options, Platform::Unix).unwrap();

        assert_eq!(plan.args, ["run", "/games/wow/Wow.exe"]);
        let keys: Vec<&str> = plan.env.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"STEAM_COMPAT_DATA_PATH"));
        assert!(keys.contains(&"STEAM_COMPAT_CLIENT_INSTALL_PATH"));
    }

    #[test]
    fn proton_without_a_steam_root_fails_before_it_confuses_anyone() {
        let mut runtime = proton();
        runtime.steam_root = None;
        let options = LaunchOptions {
            runtime: Some(runtime),
            prefix: Some(PathBuf::from("/data/prefix")),
            ..LaunchOptions::default()
        };
        let error = plan(&client(), &options, Platform::Unix).unwrap_err();
        assert!(error.to_string().contains("Steam"));
    }

    #[test]
    fn no_runtime_on_unix_is_the_error_that_tells_you_to_install_wine() {
        let error = plan(&client(), &LaunchOptions::default(), Platform::Unix).unwrap_err();
        assert!(matches!(error, Error::NoWine));
        assert!(error.to_string().contains("Proton"));
    }

    #[test]
    fn the_displayed_command_is_something_you_could_paste_into_a_shell() {
        let options = LaunchOptions {
            runtime: Some(proton()),
            prefix: Some(PathBuf::from("/data/prefix")),
            ..LaunchOptions::default()
        };
        let shown = plan(&client(), &options, Platform::Unix).unwrap().display();
        assert!(shown.contains("STEAM_COMPAT_DATA_PATH=/data/prefix"));
        assert!(shown.contains("\"/steam/steamapps/common/Proton 9.0/proton\""));
    }
}
