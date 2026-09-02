/**
 * The bridge to the Rust side.
 *
 * Also the reason this interface can be opened in an ordinary browser: when
 * Tauri is not there, `demo` answers instead. That is not a toy — it is how the
 * design gets reviewed, and how the UI is worked on without a 15 GB client and
 * a built Rust binary on the machine.
 */
import type { Account, Progress, Report, Runtime, Settings, Status } from "./types";

const inTauri = "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function pickFolder(): Promise<string | null> {
  if (!inTauri) return "/home/player/games/World of Warcraft 3.3.5a";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({ directory: true, multiple: false, title: "Where is your 3.3.5a client?" });
  return typeof chosen === "string" ? chosen : null;
}

export async function onProgress(handler: (p: Progress) => void): Promise<void> {
  if (!inTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<Progress>("verify:progress", (event) => handler(event.payload));
}

/** Provisioning has no percentage worth showing, so it narrates instead. */
export async function onStep(handler: (step: string) => void): Promise<void> {
  if (!inTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>("provision:step", (event) => handler(event.payload));
}

export const api = {
  status: () => (inTauri ? call<Status>("status") : demo.status()),
  refresh: () => (inTauri ? call<Status>("refresh") : demo.status()),
  chooseClient: (path: string) =>
    inTauri ? call<Status>("choose_client", { path }) : demo.chooseClient(),
  verify: () => (inTauri ? call<Report>("verify") : demo.verify()),
  ledger: () => (inTauri ? call<Report | null>("ledger") : demo.ledger()),
  applyConfig: () => (inTauri ? call<string[]>("apply_config") : demo.written()),
  installPatches: () => (inTauri ? call<string[]>("install_patches") : demo.written()),
  provisionRuntime: () =>
    inTauri ? call<string[]>("provision_runtime") : demo.provisionRuntime(),
  login: (username: string, password: string) =>
    inTauri ? call<Account>("login", { username, password }) : demo.login(username),
  runtimes: () => (inTauri ? call<Runtime[]>("runtimes") : demo.runtimes()),
  settings: () => (inTauri ? call<Settings>("settings") : demo.settings()),
  saveSettings: (settings: Settings) =>
    inTauri ? call<Status>("save_settings", { settings }) : demo.status(),
  launchCommand: () => (inTauri ? call<string>("launch_command") : demo.launchCommand()),
  launch: () => (inTauri ? call<void>("launch") : demo.launch()),
};

/* ------------------------------------------------------------------ *
 * Demo answers — a client that is verified but not perfect, which is
 * the state most real installs are actually in.
 * ------------------------------------------------------------------ */

let chosen = true;
let verified = true;
let provisioned = false;

const demoReport: Report = {
  files: [
    { path: "Data/common.MPQ", state: { state: "match" } },
    { path: "Data/common-2.MPQ", state: { state: "match" } },
    { path: "Data/expansion.MPQ", state: { state: "match" } },
    { path: "Data/lichking.MPQ", state: { state: "match" } },
    { path: "Data/patch.MPQ", state: { state: "match" } },
    { path: "Data/patch-2.MPQ", state: { state: "match" } },
    { path: "Data/patch-3.MPQ", state: { state: "match" } },
    {
      path: "Data/enUS/backup.MPQ",
      state: {
        state: "differs",
        expected: "5d41402abc4b2a76b9719d911017c592af1349b9f5f9a1a6a0404dea36dcc949",
        found: "9bcb25c9adc112b7cc9a93cae41f3262e7b1f2c8a5d90bb1cc0a3f11ea6d4bd2",
      },
    },
    { path: "Data/enUS/base-enUS.MPQ", state: { state: "match" } },
    { path: "Data/enUS/speech-enUS.MPQ", state: { state: "match" } },
    { path: "Data/enUS/patch-enUS.MPQ", state: { state: "wrong_size", expected: 245891072, found: 245891008 } },
    { path: "Data/enUS/patch-enUS-2.MPQ", state: { state: "match" } },
    { path: "Data/enUS/patch-enUS-3.MPQ", state: { state: "match" } },
    { path: "Data/enGB/locale-enGB.MPQ", state: { state: "missing" } },
    { path: "Wow.exe", state: { state: "match" } },
  ],
  matched: 12,
  differing: 2,
  missing: 1,
  unreadable: 0,
  bytes_hashed: 14_982_311_936,
  complete: false,
};

const demo = {
  async status(): Promise<Status> {
    if (!chosen) {
      return {
        realm: "Ashmorrow",
        realm_address: "play.ashmorrow.example",
        client_version: "—",
        patch_level: 0,
        runtime: "Wine (system)",
        rows: [
          { key: "CLIENT", value: "not selected", state: "block", detail: "" },
          { key: "REALMLIST", value: "set realmlist play.ashmorrow.example", state: "idle", detail: "" },
          { key: "PATCH", value: "none required", state: "ok", detail: "" },
          { key: "ACCOUNT", value: "not signed in", state: "idle", detail: "optional" },
        ],
        action: "SELECT CLIENT",
        can_launch: false,
        blocked_because: "choose your World of Warcraft 3.3.5a folder",
      };
    }
    return {
      realm: "Ashmorrow",
      realm_address: "play.ashmorrow.example",
      client_version: "3.3.5.12340",
      patch_level: 0,
      runtime: "Wine (system)",
      rows: [
        { key: "CLIENT", value: "/home/player/games/wow-335a", state: "ok", detail: "" },
        ...(verified
          ? ([
              {
                key: "FILES",
                value: "12 of 15 verified — 2 differ, 1 missing",
                state: "warn",
                detail: "",
              },
            ] as const)
          : []),
        { key: "REALMLIST", value: "set realmlist play.ashmorrow.example", state: "ok", detail: "" },
        { key: "PATCH", value: "none required", state: "ok", detail: "" },
        { key: "ACCOUNT", value: "sindre · 2 characters", state: "ok", detail: "" },
        {
          key: "RUNTIME",
          value: provisioned ? "Wine (system) · ready" : "Wine (system) · not set up yet",
          state: provisioned ? "ok" : "warn",
          detail: provisioned
            ? ""
            : "the launcher will create a Wine prefix and install DXVK into it",
        },
      ],
      action: !verified ? "VERIFY" : !provisioned ? "SET UP RUNTIME" : "LAUNCH",
      can_launch: provisioned,
      blocked_because: "",
    };
  },
  async chooseClient() {
    chosen = true;
    verified = false;
    return demo.status();
  },
  async verify(): Promise<Report> {
    verified = true;
    return demoReport;
  },
  async ledger(): Promise<Report | null> {
    return verified ? demoReport : null;
  },
  async provisionRuntime(): Promise<string[]> {
    provisioned = true;
    return ["prefix at /home/player/.local/share/ashmorrow/prefix", "dxvk 2.4.1 (1 files)"];
  },
  async written(): Promise<string[]> {
    return ["/home/player/games/wow-335a/Data/enUS/realmlist.wtf"];
  },
  async login(username: string): Promise<Account> {
    return { username, characters: 2, token: "" };
  },
  async runtimes(): Promise<Runtime[]> {
    return [
      { kind: "wine", name: "Wine (system)", program: "/usr/bin/wine", steam_root: null },
      {
        kind: "proton",
        name: "Proton 9.0",
        program: "/home/player/.steam/steam/steamapps/common/Proton 9.0/proton",
        steam_root: "/home/player/.steam/steam",
      },
    ];
  },
  async settings(): Promise<Settings> {
    return {
      client_path: "/home/player/games/wow-335a",
      realm_address: null,
      realm_site: null,
      runtime_name: "Wine (system)",
      prefix: "/home/player/.local/share/ashmorrow/prefix",
      renderer: "direct3d",
      windowed: false,
      account_name: "sindre",
      extra_args: [],
    };
  },
  async launchCommand(): Promise<string> {
    return 'WINEPREFIX=/home/player/.local/share/ashmorrow/prefix WINEDEBUG=-all /usr/bin/wine "/home/player/games/wow-335a/Wow.exe"';
  },
  async launch(): Promise<void> {},
};
