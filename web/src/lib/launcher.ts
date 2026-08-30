import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "./env";

/**
 * What the launcher is told about this realm.
 *
 * The client hash list is authored in `launcher/manifests/ashmorrow.json` and
 * read from disk if it is there. The realm's own fields are *always* taken from
 * this deployment's environment and overwrite whatever the file said, because
 * the file is committed to a repository and a hostname is not a property of a
 * repository — it is a property of the machine serving it.
 *
 * When the file is absent, which is the normal case for a website deployed on
 * its own (ADR 0004: the site ships independently of everything else), the
 * realm fields alone are served and the launcher reports honestly that it has
 * no hashes to compare against.
 *
 * Nothing here can ever name a place to obtain a client. See
 * `docs/decisions/0005-client-distribution.md`.
 */

export interface LauncherManifest {
  schema: number;
  realm: { name: string; address: string; auth_port: number; world_port: number };
  client: {
    build: number;
    version: string;
    locales: string[];
    measured_from: string;
    files: { path: string; size: number; hash: string }[];
  };
  patches: {
    id: string;
    version: number;
    path: string;
    size: number;
    hash: string;
    url: string;
    summary?: string;
  }[];
  launcher: { minimum_version: string; latest_version: string };
}

/** Kept in step with `launcher_core::manifest::SCHEMA_VERSION`. */
const SCHEMA_VERSION = 1;

/** Ashmorrow is a 3.3.5a realm, and that is not a per-deployment setting. */
const CLIENT_BUILD = 12340;

/**
 * The manifest as a human authored it: hand-edited JSON, so every level of it
 * is optional and every field has to survive being absent.
 */
export type AuthoredManifest = {
  realm?: Partial<LauncherManifest["realm"]>;
  client?: Partial<LauncherManifest["client"]>;
  patches?: LauncherManifest["patches"];
  launcher?: Partial<LauncherManifest["launcher"]>;
};

interface Cached {
  manifest: LauncherManifest;
  at: number;
}

let cached: Cached | null = null;

function candidatePaths(): string[] {
  const configured = process.env.LAUNCHER_MANIFEST_PATH;
  if (configured) return [configured];
  // From `web/` in a checkout, and from the repository root when the process
  // was started there.
  return [
    join(process.cwd(), "..", "launcher", "manifests", "ashmorrow.json"),
    join(process.cwd(), "launcher", "manifests", "ashmorrow.json"),
  ];
}

/**
 * The manifest as authored, or an empty one.
 *
 * A malformed or missing file is not an error worth failing a request over —
 * the launcher copes with an empty hash list by design, and a 500 here would
 * stop players launching over a file that only affects verification detail.
 */
async function authored(): Promise<AuthoredManifest> {
  for (const path of candidatePaths()) {
    try {
      const text = await readFile(path, "utf8");
      return JSON.parse(text) as AuthoredManifest;
    } catch {
      // Try the next candidate.
    }
  }
  return {};
}

export function assembleManifest(authored: AuthoredManifest): LauncherManifest {
  const client: Partial<LauncherManifest["client"]> = authored.client ?? {};

  return {
    schema: SCHEMA_VERSION,
    realm: {
      name: env.realm.name,
      address: env.realm.address,
      auth_port: env.realm.authPort,
      world_port: env.realm.worldPort,
    },
    client: {
      build: CLIENT_BUILD,
      version: client.version ?? "3.3.5a",
      locales: client.locales ?? [],
      measured_from: client.measured_from ?? "",
      files: client.files ?? [],
    },
    // Patch URLs are absolute in the authored file and are passed through as
    // they are; the launcher refuses any that is not https.
    patches: authored.patches ?? [],
    launcher: {
      minimum_version: authored.launcher?.minimum_version ?? "0.1.0",
      latest_version: authored.launcher?.latest_version ?? "0.1.0",
    },
  };
}

/**
 * Cached for a minute. The file changes when someone deploys, not per request,
 * and a launcher polling this on every start should not cost a disk read each
 * time.
 */
export async function getLauncherManifest(): Promise<LauncherManifest> {
  const now = Date.now();
  if (cached && now - cached.at < 60_000) return cached.manifest;

  const manifest = assembleManifest(await authored());
  cached = { manifest, at: now };
  return manifest;
}

/** Test seam: drop the cache so a following call re-reads. */
export function _resetManifestCache(): void {
  cached = null;
}
