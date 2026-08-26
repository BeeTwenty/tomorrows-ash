#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Start the production server.
 *
 * Next's standalone server chdirs into its own directory before it looks for
 * .env files, so it would never find web/.env.local. Rather than copy secrets
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

const server = path.join(root, ".next", "standalone", "server.js");
await import(pathToFileURL(server).href);
