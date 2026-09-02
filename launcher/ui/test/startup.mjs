/**
 * Does the launcher still come up when part of the platform says no?
 *
 * This drives the real built bundle in a real browser engine, with the Tauri
 * bridge stubbed at exactly the seam Tauri uses — `window.__TAURI_INTERNALS__`,
 * which `@tauri-apps/api`'s `invoke` delegates to. So the code under test is
 * the shipped `dist/`, not a mock of it.
 *
 * Three scenarios, each a failure that actually reached a player's machine:
 *
 *   reachable   the happy path, so the checks below are known to be able to fail
 *   unreachable the realm is not deployed. The build that shipped abandoned
 *               every local load on that first rejection and sat on a loading
 *               line with blank tabs behind it.
 *   denied      every `plugin:*` command is refused. This is precisely what
 *               Tauri 2 does when `src-tauri/capabilities/` is missing, and it
 *               is what the second broken build did: subscribing to progress
 *               events threw before a single line of state had loaded, so the
 *               interface came up empty and — worse — silent. The earlier
 *               version of this harness could not see it, because it answered
 *               every `plugin:` call with a cheerful `0`.
 *
 *   node test/startup.mjs            # assert
 *   node test/startup.mjs --shots /tmp/out   # and write screenshots
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const shotDir = process.argv.includes("--shots")
  ? process.argv[process.argv.indexOf("--shots") + 1]
  : null;

/** The bridge, stubbed. */
function bridge({ realm, plugins }) {
  return `
    const settings = {
      client_path: null, realm_address: null, realm_site: null, runtime_name: null,
      prefix: null, renderer: "direct3d", windowed: false, account_name: null,
      extra_args: [],
    };
    const status = {
      realm: "Ashmorrow", realm_address: "", client_version: "\\u2014", patch_level: 0,
      runtime: "none",
      rows: [{ key: "CLIENT", value: "not selected", state: "block", detail: "" }],
      action: "SELECT CLIENT", can_launch: false,
      blocked_because: "choose your World of Warcraft 3.3.5a folder",
    };
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => { const id = Math.random(); window["_" + id] = cb; return id; },
      unregisterCallback: () => {},
      convertFileSrc: (p) => p,
      invoke: (cmd) => {
        if (cmd.startsWith("plugin:")) {
          ${plugins === "denied"
            // Word for word what a Tauri 2 release build rejects an
            // ungranted command with.
            ? 'return Promise.reject("Command " + cmd + " not allowed by ACL");'
            : "return Promise.resolve(0);"}
        }
        if (cmd === "refresh") {
          ${realm === "unreachable"
            ? `return Promise.reject("could not reach https://ashmorrow.example/api/launcher/manifest: dns error: failed to lookup address information");`
            : `return Promise.resolve(status);`}
        }
        if (cmd === "status") return Promise.resolve(status);
        if (cmd === "ledger") return Promise.resolve(null);
        if (cmd === "runtimes") return Promise.resolve([]);
        if (cmd === "settings") return Promise.resolve(settings);
        return Promise.resolve(null);
      },
    };
  `;
}

const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  const file = join(DIST, normalize(url === "/" ? "/index.html" : url));
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(4180, r));

// Some environments preinstall Chromium somewhere Playwright would not look;
// a CI runner installs its own and knows where it put it. Naming a path that
// does not exist is a hard failure, so only name one that does.
const preinstalled = process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium";
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
  args: ["--no-sandbox"],
});

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures += 1;
};

const scenarios = [
  { name: "realm reachable", realm: "reachable", plugins: "allowed", shot: "online" },
  { name: "realm unreachable", realm: "unreachable", plugins: "allowed", shot: "offline" },
  { name: "plugin commands denied by the ACL", realm: "reachable", plugins: "denied", shot: "denied" },
];

for (const scenario of scenarios) {
  console.log(`\n=== ${scenario.name} ===`);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, colorScheme: "dark" });
  await page.addInitScript(bridge(scenario));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto("http://127.0.0.1:4180/");
  await page.waitForTimeout(900);

  const body = (await page.textContent("body")) || "";
  if (shotDir) await page.screenshot({ path: `${shotDir}/startup-${scenario.shot}.png` });

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join("\n"));
  check(
    "status view is not stuck on the loading line",
    !body.includes("Reading the realm's configuration"),
    `body was: ${body.slice(0, 180)}`,
  );
  check("the launch bar is not stuck on STARTING", !body.includes("STARTING"));

  // The one assertion that would have caught both shipped bugs: the launcher
  // read its own state. Everything on the status view is local, so there is no
  // scenario here in which this is allowed to fail.
  check(
    "the status view shows the launcher's own state",
    body.includes("CLIENT") && !body.includes("could not read its own state"),
    `body was: ${body.slice(0, 240)}`,
  );

  if (scenario.realm === "unreachable") {
    check(
      "the readout strip does not claim the realm is live",
      !body.includes("● live") && body.includes("unreachable"),
      `body was: ${body.slice(0, 240)}`,
    );
    check(
      "the failure is actually shown to the player",
      /could not reach|dns|unreachable|offline/i.test(body),
      `body was: ${body.slice(0, 240)}`,
    );
  } else {
    check("the readout strip shows the realm as live", body.includes("● live"));
  }

  if (scenario.plugins === "denied") {
    // Progress narration is the only thing a refused `plugin:event|listen`
    // costs, so it must not surface as a failure the player has to act on.
    check(
      "a refused event subscription is not reported as a problem",
      !body.includes("That did not work"),
      `body was: ${body.slice(0, 240)}`,
    );
  }

  // Settings must populate in every scenario: none of it is network-derived
  // and none of it goes through a plugin command.
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.waitForTimeout(250);
  const settingsBody = (await page.textContent("main")) || "";
  if (shotDir) await page.screenshot({ path: `${shotDir}/settings-${scenario.shot}.png` });
  check(
    "settings tab is populated, not blank",
    settingsBody.includes("Client") && settingsBody.includes("Renderer"),
    `main was ${settingsBody.length} chars: ${settingsBody.slice(0, 120)}`,
  );

  await page.getByRole("tab", { name: "Ledger" }).click();
  await page.waitForTimeout(200);
  check("ledger tab renders something", ((await page.textContent("main")) || "").length > 0);

  await page.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
