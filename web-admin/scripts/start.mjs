#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Start the production server.
 *
 * Next's standalone server chdirs into its own directory before it looks for
 * .env files, so it would never find web-admin/.env.local. Rather than copy secrets
 * into the build output, this wrapper reads the env files from the project
 * root first and then hands over.
 *
 * Real environment variables always win, so a systemd unit, a container or a
 * shell export overrides the file - which is what a deployment expects.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** Minimal KEY=VALUE reader. Deliberately not a dotenv clone. */
async function loadEnvFile(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return 0;
  }

  let applied = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
    if (!key || key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    applied += 1;
  }
  return applied;
}

// Later files do not override earlier ones, so .env.local wins over .env.
for (const name of [".env.local", ".env"]) {
  const count = await loadEnvFile(path.join(root, name));
  if (count > 0) console.info(`Loaded ${count} settings from ${name}`);
}

process.env.NODE_ENV ??= "production";
// The panel does not share a port with the public site. Both defaulting to
// 3000 on one host is a five-minute confusion the first time it happens.
process.env.PORT ??= "3010";

/**
 * Bind to localhost, not to every interface.
 *
 * Next's standalone server defaults to 0.0.0.0. For the public site that is
 * what you want; for an operator panel on a box that also serves a public
 * website it means the sign-in page is reachable by anyone who can route to
 * the host, before any allowlist exists to say otherwise.
 *
 * So the default is 127.0.0.1 and reaching it from elsewhere is a deliberate
 * act: an SSH tunnel (`ssh -L 3010:127.0.0.1:3010 user@host`), or a reverse
 * proxy that terminates TLS and forwards to this port. Set ADMIN_BIND=0.0.0.0
 * to opt out, having decided to.
 */
process.env.HOSTNAME ??= process.env.ADMIN_BIND || "127.0.0.1";

/**
 * The standalone entry point.
 *
 * `outputFileTracingRoot` is the repository root (next.config.ts), because the
 * panel imports shared pure modules from ../web/src/lib. Next then mirrors the
 * repository layout inside .next/standalone, so the server sits one directory
 * down. Both layouts are checked rather than one being assumed - getting this
 * wrong fails at `npm start` with a bare ERR_MODULE_NOT_FOUND.
 */
const candidates = [
  path.join(root, ".next", "standalone", path.basename(root), "server.js"),
  path.join(root, ".next", "standalone", "server.js"),
];

const server = candidates.find((candidate) => existsSync(candidate));
if (!server) {
  console.error(
    "No standalone build found. Run `npm run build` first.\n" +
      `Looked in:\n${candidates.map((candidate) => `  ${candidate}`).join("\n")}`,
  );
  process.exit(1);
}

await import(pathToFileURL(server).href);
