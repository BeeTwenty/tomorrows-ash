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
  /**
   * Client patches the launcher builds locally from the player's own tables,
   * rather than downloads. ADR 0009.
   *
   * A recipe is a set of edits, not a file: the launcher fetches this JSON,
   * verifies it against `hash`, reads the player's own DBCs and builds the
   * archive on their machine. That is why there is no `path` here as there is
   * on a patch — where the built archive goes is the recipe's own `output`
   * field, and the bytes differ per client by design, so we could not publish
   * a hash for the result even if we wanted to (ADR 0009 §5).
   *
   * `version` is the only thing the launcher compares when deciding whether to
   * rebuild; `revision` is the commit that last touched `launcher/recipes/`,
   * stamped by CI, and exists so `git show <sha>` can answer "what exactly was
   * version 3" (ADR 0009 §3).
   */
  recipes: {
    id: string;
    version: number;
    revision: string;
    size: number;
    hash: string;
    url: string;
    summary?: string;
  }[];
  /** Free software the launcher installs into its own Wine prefix. */
  runtime: {
    id: string;
    kind: "dxvk";
    version: string;
    size: number;
    hash: string;
    url: string;
    licence?: string;
    summary?: string;
  }[];
  launcher: { minimum_version: string; latest_version: string };
}

/**
 * Kept in step with `launcher_core::manifest::SCHEMA_VERSION`.
 *
 * Adding `recipes` did **not** bump it, and bumping it would have been the
 * damaging move. Two facts from `launcher/core/src/manifest.rs`, read rather
 * than assumed:
 *
 *   - `Manifest` is not `deny_unknown_fields` — only `ClientFile` is, and that
 *     is deliberate (ADR 0005: an entry describing a Blizzard file must have
 *     nowhere to put a download URL). So a launcher built before recipes
 *     existed ignores the new array instead of failing to parse.
 *   - `Manifest::validate()` rejects any schema that is not exactly this
 *     number. Bumping to 2 would therefore break every launcher already in a
 *     player's hands, immediately, to announce a field they would ignore.
 *
 * Bump it when a change would make an older launcher *misread* the manifest.
 * A new optional array it never looks at is not that.
 */
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
  runtime?: LauncherManifest["runtime"];
  launcher?: Partial<LauncherManifest["launcher"]>;
};

/**
 * `launcher/patch-manifest.json` — a *second* authored file, and a different
 * one from `launcher/manifests/ashmorrow.json`.
 *
 * They are separate because they change for different reasons and by different
 * hands: the client hash list is measured from a real install, while this is
 * the index of which recipes are published and at what version (ADR 0009 §1).
 * Merging them would mean a recipe bump and a client re-measure touching the
 * same file.
 *
 * It carries its own `schema`, which is why this is a distinct type rather than
 * more optional fields on the one above.
 */
export type AuthoredPatchManifest = {
  schema?: number;
  recipes?: LauncherManifest["recipes"];
};

/** The recipe index's schema, which is versioned separately from the served one. */
const PATCH_MANIFEST_SCHEMA = 1;

interface Cached {
  manifest: LauncherManifest;
  at: number;
}

let cached: Cached | null = null;

function patchManifestPaths(): string[] {
  const configured = process.env.LAUNCHER_PATCH_MANIFEST_PATH;
  if (configured) return [configured];
  return [
    join(process.cwd(), "..", "launcher", "patch-manifest.json"),
    join(process.cwd(), "launcher", "patch-manifest.json"),
  ];
}

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

/**
 * The published recipes, or none.
 *
 * Absent, unreadable or malformed all mean the same thing here and are all
 * normal: the file lives in the repository beside the launcher, and a website
 * deployed on its own (ADR 0004) does not have it. Serving an empty array says
 * "nothing is published", which is both true and what the launcher already
 * copes with.
 *
 * A `schema` this code does not understand is the one case treated as a
 * refusal rather than an absence. Passing entries through in a shape we cannot
 * read would be guessing at a format on a document that reaches players'
 * machines, and "no recipes" is the safe reading of "I do not understand this".
 */
export function recipesFrom(authored: AuthoredPatchManifest): LauncherManifest["recipes"] {
  const schema = authored.schema ?? PATCH_MANIFEST_SCHEMA;
  if (schema !== PATCH_MANIFEST_SCHEMA) {
    console.warn(
      `[launcher] patch-manifest.json declares schema ${schema}; this site understands ` +
        `${PATCH_MANIFEST_SCHEMA}. Serving no recipes rather than entries in a shape it cannot read.`,
    );
    return [];
  }
  return authored.recipes ?? [];
}

async function authoredPatches(): Promise<AuthoredPatchManifest> {
  for (const path of patchManifestPaths()) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as AuthoredPatchManifest;
    } catch {
      // Try the next candidate.
    }
  }
  return {};
}

export function assembleManifest(
  authored: AuthoredManifest,
  patchManifest: AuthoredPatchManifest = {},
): LauncherManifest {
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
    // Third-party free software, passed through as authored. The launcher
    // refuses any URL that is not https and checks every hash before writing.
    runtime: authored.runtime ?? [],
    // Recipes come from the other authored file, passed through the same way.
    // Empty is the current and correct state: launcher/patch-manifest.json
    // lists nothing on purpose (ADR 0009 §6).
    recipes: recipesFrom(patchManifest),
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

  const [file, patchFile] = await Promise.all([authored(), authoredPatches()]);
  const manifest = assembleManifest(file, patchFile);
  cached = { manifest, at: now };
  return manifest;
}

/** Test seam: drop the cache so a following call re-reads. */
export function _resetManifestCache(): void {
  cached = null;
}
