// A launcher that opens a console window behind itself looks broken.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The window, and nothing else.
//!
//! Every command here is argument marshalling over `launcher_core`. That is
//! deliberate: this crate cannot be built without a system webview, so anything
//! that lives in it is outside `cargo test`'s reach. If a command in this file
//! grows a second branch, the branch belongs in the core.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use launcher_core::app::{Account, App, Status};
use launcher_core::net::Network;
use launcher_core::settings::{cache_path, settings_path};
use launcher_core::verify::Report;
use launcher_core::wine::Runtime;
use launcher_core::Settings;
use tauri::{Emitter, Manager};

/// Where the manifest and the account API live. Overridable so the launcher can
/// be pointed at a local `npm run dev` while the site is being worked on.
const DEFAULT_BASE_URL: &str = "https://ashmorrow.example";

struct Shared {
    app: Mutex<App>,
    http: Network,
    /// `--self-check`: print what the interface reports at startup and exit on
    /// it, so a machine can answer "does this binary come up" without a person
    /// looking at a screenshot.
    self_check: bool,
}

/// What the interface managed to load. Sent once, unconditionally, at the end
/// of startup.
///
/// This exists because the launcher shipped broken twice and no automated check
/// anywhere could tell: `cargo test` cannot build a webview, and a harness that
/// stubs the bridge only ever tests the stub. The interface is the only thing
/// that knows whether the interface worked, so it says so.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct StartupReport {
    status: bool,
    settings: bool,
    runtimes: bool,
    ledger: bool,
    /// Whether `plugin:event|listen` was granted. Not fatal — the launcher runs
    /// without live progress — but a false here means the capability file is
    /// wrong, and that is worth knowing before a player finds out.
    events: bool,
    /// Anything that failed, already written for a person to read.
    problems: Vec<String>,
}

impl StartupReport {
    /// Everything local loaded. The realm is deliberately not part of this: it
    /// is allowed to be unreachable, and usually is.
    fn healthy(&self) -> bool {
        self.status && self.settings && self.runtimes && self.ledger
    }
}

static REPORTED: AtomicBool = AtomicBool::new(false);

/// `launcher_core::Error` carries paths and reasons a player should see, and
/// Tauri needs a `String` on the wire.
type Answer<T> = Result<T, String>;

fn say<T>(result: launcher_core::Result<T>) -> Answer<T> {
    result.map_err(|error| error.to_string())
}

/// The interface reporting on its own startup.
///
/// In normal use this is a line on stderr, which is where a player's `--help`
/// -less bug report can be told to look. Under `--self-check` it is the whole
/// point of the run: print it and exit on it.
#[tauri::command]
fn report_startup(shared: tauri::State<'_, Shared>, report: StartupReport) {
    REPORTED.store(true, Ordering::SeqCst);
    // Three words, not two. "Local state loaded but the event subscription was
    // refused" is a real and distinct state: the launcher works, and the
    // capability file is still wrong. Calling that "ok" is how it ships.
    let verdict = match (report.healthy(), report.events) {
        (true, true) => "ok",
        (true, false) => "degraded",
        (false, _) => "BROKEN",
    };
    eprintln!(
        "startup {verdict}: status={} settings={} runtimes={} ledger={} events={}",
        report.status, report.settings, report.runtimes, report.ledger, report.events
    );
    for problem in &report.problems {
        eprintln!("  problem: {problem}");
    }
    if shared.self_check {
        if !report.events {
            // Non-fatal at runtime, fatal here: shipping this is how the
            // interface came up blank on a player's machine.
            eprintln!("  the event subscription was refused — check src-tauri/capabilities/");
        }
        std::process::exit(if report.healthy() && report.events { 0 } else { 1 });
    }
}

#[tauri::command]
fn status(shared: tauri::State<'_, Shared>) -> Answer<Status> {
    Ok(shared.app.lock().unwrap().status())
}

#[tauri::command]
fn refresh(shared: tauri::State<'_, Shared>) -> Answer<Status> {
    let mut app = shared.app.lock().unwrap();
    say(app.refresh_manifest(&shared.http))?;
    Ok(app.status())
}

#[tauri::command]
fn choose_client(shared: tauri::State<'_, Shared>, path: String) -> Answer<Status> {
    let mut app = shared.app.lock().unwrap();
    say(app.choose_client(path))?;
    Ok(app.status())
}

/// Long-running: reads the whole client. Tauri runs synchronous commands off
/// the UI thread, so the window stays responsive while this works.
#[tauri::command]
fn verify(handle: tauri::AppHandle, shared: tauri::State<'_, Shared>) -> Answer<Report> {
    let mut app = shared.app.lock().unwrap();
    say(app.verify(&|progress| {
        // A dropped progress event is a slightly stale bar, never a failure.
        let _ = handle.emit(
            "verify:progress",
            serde_json::json!({
                "filesDone": progress.files_done,
                "filesTotal": progress.files_total,
                "bytesDone": progress.bytes_done,
                "bytesTotal": progress.bytes_total,
            }),
        );
    }))
}

#[tauri::command]
fn ledger(shared: tauri::State<'_, Shared>) -> Answer<Option<Report>> {
    Ok(shared.app.lock().unwrap().last_report().cloned())
}

#[tauri::command]
fn apply_config(shared: tauri::State<'_, Shared>) -> Answer<Vec<String>> {
    let mut app = shared.app.lock().unwrap();
    let written = say(app.apply_config())?;
    Ok(written.iter().map(|p| p.display().to_string()).collect())
}

#[tauri::command]
fn install_patches(shared: tauri::State<'_, Shared>) -> Answer<Vec<String>> {
    let mut app = shared.app.lock().unwrap();
    let installed = say(app.install_patches(&shared.http))?;
    Ok(installed.iter().map(|p| p.display().to_string()).collect())
}

#[tauri::command]
fn login(shared: tauri::State<'_, Shared>, username: String, password: String) -> Answer<Account> {
    let mut app = shared.app.lock().unwrap();
    say(app.login(&shared.http, &username, &password))
}

#[tauri::command]
fn runtimes(shared: tauri::State<'_, Shared>) -> Answer<Vec<Runtime>> {
    Ok(shared.app.lock().unwrap().runtimes().to_vec())
}

/// Set up the Wine prefix and install what the game needs to run in it.
///
/// Long-running: it shells out to Wine and downloads. Steps are emitted as they
/// happen, because "creating the Wine prefix" for ninety seconds is a very
/// different experience from an unlabelled spinner.
#[tauri::command]
fn provision_runtime(
    handle: tauri::AppHandle,
    shared: tauri::State<'_, Shared>,
) -> Answer<Vec<String>> {
    let mut app = shared.app.lock().unwrap();
    say(app.provision_runtime(&shared.http, &|step| {
        let _ = handle.emit("provision:step", step);
    }))
}

#[tauri::command]
fn settings(shared: tauri::State<'_, Shared>) -> Answer<Settings> {
    Ok(shared.app.lock().unwrap().settings.clone())
}

#[tauri::command]
fn save_settings(shared: tauri::State<'_, Shared>, settings: Settings) -> Answer<Status> {
    let mut app = shared.app.lock().unwrap();
    app.settings = settings;
    say(app.save_settings())?;
    Ok(app.status())
}

/// The exact command line, so a player can paste it into a bug report — or into
/// a terminal, when the launcher itself is the thing that is broken.
#[tauri::command]
fn launch_command(shared: tauri::State<'_, Shared>) -> Answer<String> {
    let app = shared.app.lock().unwrap();
    Ok(say(app.launch_plan())?.display())
}

#[tauri::command]
fn launch(shared: tauri::State<'_, Shared>) -> Answer<()> {
    let app = shared.app.lock().unwrap();
    let plan = say(app.launch_plan())?;
    plan.command()
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not start {}: {e}", plan.program.display()))
}

fn main() {
    let base_url = std::env::var("ASHMORROW_BASE_URL")
        .ok()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

    let self_check = std::env::args().any(|arg| arg == "--self-check");
    if self_check {
        // If the interface never gets far enough to report, nothing else will
        // ever say so — the window just sits there, which is precisely the
        // failure being tested for. Fail loudly instead of hanging a runner.
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(60));
            if !REPORTED.load(Ordering::SeqCst) {
                eprintln!("startup BROKEN: the interface never reported in 60s");
                std::process::exit(1);
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |handle| {
            // Falling back to the working directory keeps the launcher usable on
            // a machine with no home directory set, which is every CI runner.
            let settings = settings_path().unwrap_or_else(|| "settings.json".into());
            let cache = cache_path().unwrap_or_else(|| "hashes.json".into());
            handle.manage(Shared {
                app: Mutex::new(App::new(base_url.clone(), settings, cache)),
                http: Network::new(),
                self_check,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            report_startup,
            status,
            refresh,
            choose_client,
            verify,
            ledger,
            apply_config,
            install_patches,
            provision_runtime,
            login,
            runtimes,
            settings,
            save_settings,
            launch_command,
            launch,
        ])
        .run(tauri::generate_context!())
        .expect("the launcher window could not be created");
}
