/**
 * Does the launcher still work when the realm is unreachable?
 *
 * This drives the real built bundle in a real browser engine, with the Tauri
 * bridge stubbed at exactly the seam Tauri uses — `window.__TAURI_INTERNALS__`,
 * which `@tauri-apps/api`'s `invoke` delegates to. So the code under test is
 * the shipped `dist/`, not a mock of it.
 *
 * It exists because the launcher shipped a startup that abandoned everything
 * on the first failed call, and the failure it abandoned on was reaching a
 * realm that is not deployed yet. A player saw "Reading the realm's
 * configuration…" for ever and blank tabs behind it.
 *
 *   node test/startup.mjs            # assert
 *   node test/startup.mjs --shots /tmp/out   # and write screenshots
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const shotDir = process.argv.includes("--shots")
  ? process.argv[process.argv.indexOf("--shots") + 1]
  : null;

/** The bridge, stubbed. `offline` makes the realm unreachable. */
function bridge({ offline }) {
  return `
    const settings = {
      client_path: null, realm_address: null, runtime_name: null, prefix: null,
      renderer: "direct3d", windowed: false, account_name: null, extra_args: [],
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
        if (cmd.startsWith("plugin:")) return Promise.resolve(0);
        if (cmd === "refresh") {
          ${offline
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

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures += 1;
};

for (const offline of [true, false]) {
  console.log(`\n=== realm ${offline ? "UNREACHABLE" : "reachable"} ===`);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, colorScheme: "dark" });
  await page.addInitScript(bridge({ offline }));
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto("http://127.0.0.1:4180/");
  await page.waitForTimeout(900);

  const body = (await page.textContent("body")) || "";
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/startup-${offline ? "offline" : "online"}.png` });
  }

  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.join("\n"));
  check(
    "status view is not stuck on the loading line",
    !body.includes("Reading the realm's configuration"),
    `body was: ${body.slice(0, 180)}`,
  );
  check("the launch bar is not stuck on STARTING", !body.includes("STARTING"));

  if (offline) {
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
  }

  if (!offline) {
    check("the readout strip shows the realm as live", body.includes("\u25cf live"));
  }

  // Settings must populate whether or not the realm answered: none of it is
  // network-derived.
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.waitForTimeout(250);
  const settingsBody = (await page.textContent("main")) || "";
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/settings-${offline ? "offline" : "online"}.png` });
  }
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
