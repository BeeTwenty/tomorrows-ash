/**
 * The Ashmorrow launcher's interface.
 *
 * No framework: three views, one state object, and a render function. A launcher
 * that needs a virtual DOM to draw four status rows has been over-thought, and
 * every kilobyte here is one the player downloads before deciding to care.
 */
import { api, onProgress, onStep, pickFolder } from "./api";
import type { FileReport, Progress, Report, Runtime, Settings, Status } from "./types";

type View = "status" | "ledger" | "settings";

interface State {
  view: View;
  status: Status | null;
  report: Report | null;
  runtimes: Runtime[];
  settings: Settings | null;
  progress: Progress | null;
  busy: string | null;
  /** Something the player asked for failed. */
  error: string | null;
  /** The realm could not be reached. Not fatal — most of the launcher is local. */
  realmError: string | null;
}

const state: State = {
  view: "status",
  status: null,
  report: null,
  runtimes: [],
  settings: null,
  progress: null,
  busy: null,
  error: null,
  realmError: null,
};

const root = document.getElementById("app")!;

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/** Everything reaching the DOM goes through here. No `innerHTML` with data in it. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function bytes(count: number): string {
  if (count < 1024) return `${count} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = count / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function strip(): HTMLElement {
  const s = state.status;
  const bar = el("div", { class: "strip" });
  bar.append(el("span", { class: "mark" }, "ASHMORROW"));

  if (s) {
    // Ember, and only here: the realm is alive. Same meaning as on the site —
    // which is exactly why it must not show when we could not reach the realm.
    // It was unconditional, and cheerfully said "live" over a DNS failure.
    const reached = !state.realmError;
    bar.append(
      el(
        "span",
        {
          class: reached ? "live" : "unreachable",
          title: reached
            ? `${s.realm} · ${s.realm_address}`
            : "the realm's configuration could not be fetched",
        },
        reached ? "● live" : "○ unreachable",
      ),
    );
    bar.append(el("span", {}, s.client_version));
    bar.append(el("span", {}, `patch ${s.patch_level}`));
    bar.append(el("span", {}, s.runtime));
  }

  bar.append(el("div", { class: "spacer" }));

  const tabs = el("div", { class: "tabs", role: "tablist" });
  for (const [view, label] of [
    ["status", "Status"],
    ["ledger", "Ledger"],
    ["settings", "Settings"],
  ] as [View, string][]) {
    const tab = el("button", {
      class: "tab",
      role: "tab",
      "aria-selected": String(state.view === view),
    });
    tab.textContent = label;
    tab.onclick = () => {
      state.view = view;
      render();
    };
    tabs.append(tab);
  }
  bar.append(tabs);
  return bar;
}

function statusView(): HTMLElement {
  const main = el("main");
  const s = state.status;

  // Deliberately not an early return. The version of this that returned here
  // when `status` was null put the loading line on screen for ever and hid the
  // error that explained why — the launcher's whole posture is diagnosis, and
  // it was doing the opposite.
  if (!s) {
    main.append(
      el(
        "p",
        { class: "hint" },
        state.busy ? "Starting…" : "The launcher could not read its own state.",
      ),
    );
    main.append(problems());
    return main;
  }

  const rows = el("div", { class: "rows" });
  for (const row of s.rows) {
    const value = el("div", {});
    value.append(el("div", { class: "value" }, row.value));

    // The progress bar belongs to whichever row is being worked on.
    if (row.key === "CLIENT" && state.progress) {
      const p = state.progress;
      const done = p.bytesTotal > 0 ? (p.bytesDone / p.bytesTotal) * 100 : 0;
      const bar = el("div", { class: "bar" });
      bar.append(el("span", { style: `width:${done.toFixed(1)}%` }));
      value.append(bar);
      value.append(
        el("div", { class: "detail" }, `verified ${p.filesDone} of ${p.filesTotal} files`),
      );
    } else if (row.detail) {
      value.append(el("div", { class: "detail" }, row.detail));
    }

    const line = el("div", { class: "row" });
    line.append(el("div", { class: "key" }, row.key), value);
    line.append(el("div", { class: `pip ${row.state}` }, row.state === "ok" ? "●" : "○"));
    rows.append(line);
  }
  main.append(rows);

  main.append(problems());

  if (!state.error && !state.realmError && s.blocked_because) {
    main.append(note("block", "▲", [s.blocked_because]));
  }

  if (state.report && !state.report.complete) {
    const r = state.report;
    const details = el("button", { class: "link" }, "Details ▸");
    details.onclick = () => {
      state.view = "ledger";
      render();
    };
    main.append(
      note("warn", "▲", [
        `${r.differing + r.missing} of ${r.files.length} files differ from the build we measured. `,
        "That does not mean your client is broken — it means it is not the copy we hashed. ",
        details,
      ]),
    );
  }

  return main;
}

/**
 * Everything currently wrong, rendered wherever the player is looking.
 *
 * The realm being unreachable is a *warning*: the manifest supplies the realm
 * address and the file hashes, and everything else — choosing a client,
 * checking its build, settings, Wine, launching — is local and still works.
 */
function problems(): DocumentFragment {
  const out = document.createDocumentFragment();

  if (state.error) {
    out.append(note("block", "▲", [el("b", {}, "That did not work. "), state.error]));
  }

  if (state.realmError) {
    const retry = el("button", { class: "link" }, "Try again");
    retry.onclick = () => void refreshRealm();

    const settings = el("button", { class: "link" }, "Settings");
    settings.onclick = () => {
      state.view = "settings";
      render();
    };

    out.append(
      note("warn", "▲", [
        el("b", {}, "The realm could not be reached. "),
        "You can still choose a client, check it and start the game — only the " +
          "realm's own configuration is missing. Set its address, or the site to " +
          "fetch it from, in ",
        settings,
        ". ",
        retry,
        el("div", { class: "detail" }, state.realmError),
      ]),
    );
  }

  return out;
}

function note(kind: "warn" | "block", flag: string, children: (Node | string)[]): HTMLElement {
  const box = el("div", { class: `note ${kind}` });
  box.append(el("span", { class: "flag" }, flag));
  box.append(el("span", {}, ...children));
  return box;
}

function describe(file: FileReport): [string, string, string] {
  switch (file.state.state) {
    case "match":
      return ["ok", "match", ""];
    case "differs":
      return ["warn", "differs", `expected ${file.state.expected.slice(0, 16)}…`];
    case "wrong_size":
      return [
        "warn",
        "size",
        `expected ${bytes(file.state.expected)}, found ${bytes(file.state.found)}`,
      ];
    case "missing":
      return ["warn", "missing", ""];
    case "unreadable":
      return ["block", "unreadable", file.state.reason];
  }
}

function ledgerView(): HTMLElement {
  const main = el("main");
  const report = state.report;

  if (!report) {
    main.append(
      el("p", { class: "hint" }, "Nothing verified yet. Run a verification from the status view."),
    );
    return main;
  }

  main.append(
    el(
      "p",
      { class: "hint" },
      `${report.matched} matched · ${report.differing} differ · ${report.missing} missing · ` +
        `${bytes(report.bytes_hashed)} read`,
    ),
  );

  const table = el("table");
  const head = el("tr");
  for (const column of ["File", "State", "Note"]) head.append(el("th", {}, column));
  table.append(el("thead", {}, head));

  const body = el("tbody");
  for (const file of report.files) {
    const [pip, label, detail] = describe(file);
    const line = el("tr");
    line.append(el("td", {}, file.path));
    const cell = el("td", { class: "state" });
    cell.append(el("span", { class: `pip ${pip}` }, "● "), label);
    line.append(cell);
    line.append(el("td", { class: "note-cell" }, detail));
    body.append(line);
  }
  table.append(body);
  main.append(table);
  return main;
}

function settingsView(): HTMLElement {
  const main = el("main");
  const settings = state.settings;

  // A blank tab tells the player nothing and looks like a crash. This one
  // returned an empty <main> whenever settings had not loaded, which is
  // exactly what a failed startup produced.
  if (!settings) {
    main.append(problems());
    main.append(
      el("p", { class: "hint" }, "Settings could not be loaded, so there is nothing to show yet."),
    );
    return main;
  }

  main.append(problems());

  const save = async (change: Partial<Settings>) => {
    Object.assign(settings, change);
    await run("saving", async () => {
      state.status = await api.saveSettings(settings);
    });
  };

  main.append(el("h2", {}, "Client"));
  main.append(
    field(
      "Folder",
      textInput(settings.client_path ?? "", { readonly: "readonly" }),
      button("Change…", async () => {
        const chosen = await pickFolder();
        if (!chosen) return;
        await run("reading the client", async () => {
          state.status = await api.chooseClient(chosen);
          state.report = null;
          state.settings = await api.settings();
        });
      }),
    ),
  );
  main.append(
    el(
      "p",
      { class: "hint" },
      "Ashmorrow needs a World of Warcraft 3.3.5a client, build 12340, that you already own. " +
        "The launcher does not download one and never will.",
    ),
  );

  main.append(el("h2", {}, "Running the game"));

  if (state.runtimes.length > 0) {
    const select = el("select");
    for (const runtime of state.runtimes) {
      const option = el("option", { value: runtime.name }, `${runtime.name} — ${runtime.program}`);
      if (runtime.name === settings.runtime_name) option.setAttribute("selected", "selected");
      select.append(option);
    }
    select.onchange = () => void save({ runtime_name: select.value });
    main.append(field("Wine / Proton", select));
  } else {
    main.append(field("Wine / Proton", el("div", { class: "hint" }, "none found on this machine")));
  }

  const renderer = el("select");
  for (const [value, label] of [
    ["direct3d", "Direct3D 9 (default)"],
    ["opengl", "OpenGL — try this if the game will not draw"],
  ] as const) {
    const option = el("option", { value }, label);
    if (settings.renderer === value) option.setAttribute("selected", "selected");
    renderer.append(option);
  }
  renderer.onchange = () => void save({ renderer: renderer.value as Settings["renderer"] });
  main.append(field("Renderer", renderer));

  const windowed = el("input", { type: "checkbox" });
  windowed.checked = settings.windowed;
  windowed.onchange = () => void save({ windowed: windowed.checked });
  main.append(field("Windowed", windowed));

  main.append(el("h2", {}, "Realm"));

  const site = textInput(settings.realm_site ?? "", { placeholder: "https://your-realm.example" });
  site.onchange = () => {
    void save({ realm_site: site.value || null }).then(() => refreshRealm());
  };
  main.append(field("Website", site));
  main.append(
    el(
      "p",
      { class: "hint" },
      "Where the launcher fetches the realm's configuration and file hashes. " +
        "Leave empty to use the address this build shipped with.",
    ),
  );

  const address = textInput(settings.realm_address ?? "", { placeholder: "from the realm" });
  address.onchange = () => void save({ realm_address: address.value || null });
  main.append(field("Address", address));
  main.append(
    el(
      "p",
      { class: "hint" },
      "Leave empty to use the address the realm publishes. Set it to a LAN address to test " +
        "against a server on your own network.",
    ),
  );

  main.append(el("h2", {}, "Account"));
  const username = textInput(settings.account_name ?? "");
  const password = el("input", { type: "password", placeholder: "not stored" });
  main.append(
    field(
      "Sign in",
      username,
      button("Sign in", async () => {
        await run("signing in", async () => {
          const account = await api.login(username.value, password.value);
          password.value = "";
          state.settings = await api.settings();
          state.status = await api.status();
          state.error = null;
          void account;
        });
      }),
    ),
  );
  main.append(field("Password", password));
  main.append(
    el(
      "p",
      { class: "hint" },
      "Signing in shows your account and pre-fills the name on the game's login screen. " +
        "It cannot skip that screen: the client does its own login, and typing your password " +
        "into it for you would mean writing into the running game's memory, which this " +
        "launcher does not do.",
    ),
  );

  return main;
}

function field(label: string, ...controls: (Node | string)[]): HTMLElement {
  const wrap = el("div", { class: "field" });
  wrap.append(el("label", {}, label));
  wrap.append(el("div", { class: "inline" }, ...controls));
  return wrap;
}

function textInput(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const input = el("input", { type: "text", ...attrs });
  input.value = value;
  return input;
}

function button(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = el("button", { class: "ghost" }, label);
  b.onclick = () => void onClick();
  return b;
}

function launchBar(): HTMLElement {
  const s = state.status;
  const bar = el("button", { class: "launch" });

  if (state.busy) {
    bar.className = "launch busy";
    bar.disabled = true;
    bar.textContent = state.busy.toUpperCase();
    return bar;
  }
  if (!s) {
    bar.disabled = true;
    // "STARTING" for ever was the second half of the hang: with no status there
    // was no button, so no way to do anything about it either.
    bar.textContent = "UNAVAILABLE";
    bar.append(el("span", { class: "why" }, "the launcher could not read its own state"));
    return bar;
  }

  bar.textContent = s.action;
  bar.disabled = s.action === "BLOCKED";
  if (s.blocked_because) bar.append(el("span", { class: "why" }, s.blocked_because));

  bar.onclick = () => void act();
  return bar;
}

/* ------------------------------------------------------------------ *
 * Behaviour
 * ------------------------------------------------------------------ */

/** One button, whose meaning is whatever the status says it is. */
async function act(): Promise<void> {
  const action = state.status?.action;

  if (action === "SELECT CLIENT") {
    const chosen = await pickFolder();
    if (!chosen) return;
    return run("reading the client", async () => {
      state.status = await api.chooseClient(chosen);
      state.report = null;
    });
  }

  if (action === "VERIFY") {
    return run("verifying", async () => {
      state.report = await api.verify();
      await api.applyConfig();
      state.status = await api.status();
      state.progress = null;
    });
  }

  if (action === "SET UP RUNTIME") {
    return run("setting up the runtime", async () => {
      await api.provisionRuntime();
      state.status = await api.status();
    });
  }

  if (action === "INSTALL PATCH") {
    return run("installing", async () => {
      await api.installPatches();
      state.status = await api.status();
    });
  }

  if (action === "LAUNCH") {
    return run("launching", async () => {
      await api.applyConfig();
      await api.launch();
      state.status = await api.status();
    });
  }
}

/**
 * Fetch the realm's configuration. Failing is normal and non-fatal.
 *
 * The realm may not be deployed, the player may be offline, the site may be
 * down. None of that should stop someone verifying a client or starting the
 * game, so this records the failure and returns rather than throwing.
 */
async function refreshRealm(): Promise<void> {
  state.busy = "reading the realm";
  state.realmError = null;
  render();
  try {
    state.status = await api.refresh();
  } catch (error) {
    state.realmError = error instanceof Error ? error.message : String(error);
    // Fall back to the local view of the world, which needs no network.
    try {
      state.status = await api.status();
    } catch {
      // Leave status as it was; `problems()` explains either way.
    }
  } finally {
    state.busy = null;
    render();
  }
}

async function run(label: string, work: () => Promise<void>): Promise<void> {
  state.busy = label;
  state.error = null;
  render();
  try {
    await work();
  } catch (error) {
    // The Rust side's errors are already written for a player to read, so they
    // are shown as they are rather than wrapped in something vaguer.
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = null;
    render();
  }
}

function render(): void {
  root.replaceChildren(
    strip(),
    state.view === "status" ? statusView() : state.view === "ledger" ? ledgerView() : settingsView(),
    launchBar(),
  );
}

async function start(): Promise<void> {
  render();
  await onStep((step) => {
    // The busy label is the narration: one line, replaced, never a log.
    if (state.busy) {
      state.busy = step;
      render();
    }
  });
  await onProgress((progress) => {
    state.progress = progress;
    // Only the bar changed; a full re-render at hashing speed would be the one
    // place this UI could feel slow.
    render();
  });

  // Everything here is local — settings on disk, Wine on the PATH, the cached
  // ledger, the launcher's own view of the client. None of it needs the realm,
  // and each is loaded independently so that one failure cannot blank the rest.
  // The version that fetched the manifest first, in one all-or-nothing block,
  // left every tab empty whenever the realm was unreachable.
  const failures: string[] = [];
  const local = async (what: string, load: () => Promise<void>) => {
    try {
      await load();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await Promise.all([
    local("settings", async () => {
      state.settings = await api.settings();
    }),
    local("runtimes", async () => {
      state.runtimes = await api.runtimes();
    }),
    local("ledger", async () => {
      state.report = await api.ledger();
    }),
    local("status", async () => {
      state.status = await api.status();
    }),
  ]);

  if (failures.length > 0) state.error = failures.join("; ");
  render();

  // Only now the network.
  await refreshRealm();
}

void start();
