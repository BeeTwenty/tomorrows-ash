import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleManifest, type AuthoredManifest } from "./launcher";
import { env } from "./env";

/**
 * The manifest is what a launcher on a player's machine acts on, so the things
 * asserted here are the things that would break someone's install.
 */

test("the realm's own fields always come from this deployment, never the file", () => {
  const manifest = assembleManifest({
    realm: { name: "Somewhere Else", address: "wrong.example", auth_port: 1, world_port: 2 },
  });

  assert.equal(manifest.realm.name, env.realm.name);
  assert.equal(manifest.realm.address, env.realm.address);
  assert.equal(manifest.realm.auth_port, env.realm.authPort);
  assert.equal(manifest.realm.world_port, env.realm.worldPort);
});

test("a missing manifest file still produces something a launcher can act on", () => {
  const manifest = assembleManifest({});

  assert.equal(manifest.schema, 1);
  assert.equal(manifest.client.build, 12340, "Ashmorrow is a 3.3.5a realm");
  assert.deepEqual(manifest.client.files, []);
  assert.deepEqual(manifest.patches, []);
});

test("the client build is ours to state, not the file's to override", () => {
  const manifest = assembleManifest({
    client: { build: 8606, version: "2.4.3", locales: [], measured_from: "", files: [] },
  });
  assert.equal(manifest.client.build, 12340);
});

test("authored hashes and patches are passed through", () => {
  const hash = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";
  const manifest = assembleManifest({
    client: {
      build: 12340,
      version: "3.3.5a",
      locales: ["enUS"],
      measured_from: "enUS retail",
      files: [{ path: "Data/common.MPQ", size: 100, hash }],
    },
    patches: [
      { id: "ash-base", version: 2, path: "Data/patch-4.MPQ", size: 10, hash, url: "https://p.example/a" },
    ],
  });

  assert.equal(manifest.client.files.length, 1);
  assert.equal(manifest.client.files[0]?.path, "Data/common.MPQ");
  assert.equal(manifest.client.measured_from, "enUS retail");
  assert.equal(manifest.patches[0]?.id, "ash-base");
});

test("nothing in an assembled manifest can name a place to get a client", () => {
  const serialised = JSON.stringify(assembleManifest({})).toLowerCase();
  for (const forbidden of ["magnet:", ".torrent", "archive.org"]) {
    assert.ok(!serialised.includes(forbidden), `manifest must never contain ${forbidden}`);
  }
});

/* ------------------------------------------------------------------ *
 * Recipes (ADR 0009)
 *
 * A recipe reaches a player's machine and edits their client, so the things
 * asserted here are the ones that would misbuild someone's patch — or, in the
 * schema-version case, stop every existing launcher reading the manifest at
 * all.
 * ------------------------------------------------------------------ */

const RECIPE = {
  id: "body-types",
  version: 3,
  revision: "9f1c2ab0000000000000000000000000000000aa",
  size: 4096,
  hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
  url: "https://ashmorrow.example/recipes/body-types-3.json",
  summary: "Three body types at character creation",
};

test("no patch manifest means no recipes, which is the current true state", () => {
  const manifest = assembleManifest({});
  assert.deepEqual(manifest.recipes, []);
});

test("an empty recipes array is served as empty, not dropped", () => {
  // launcher/patch-manifest.json ships `"recipes": []` deliberately: the recipe
  // exists and is reviewable but is published to nobody.
  const manifest = assembleManifest({}, { schema: 1, recipes: [] });
  assert.deepEqual(manifest.recipes, []);
});

test("a published recipe is passed through as authored", () => {
  const manifest = assembleManifest({}, { schema: 1, recipes: [RECIPE] });
  assert.deepEqual(manifest.recipes, [RECIPE]);
});

test("recipes come from the patch manifest, never from the client manifest", () => {
  // The two authored files are separate on purpose (ADR 0009 §1). Reading
  // recipes out of the wrong one would make a client re-measure and a recipe
  // bump touch the same file.
  const manifest = assembleManifest(
    { patches: [], runtime: [] } as AuthoredManifest,
    { schema: 1, recipes: [RECIPE] },
  );
  assert.deepEqual(manifest.recipes, [RECIPE]);
  assert.deepEqual(manifest.patches, []);
});

test("a patch manifest schema we do not understand serves no recipes", () => {
  const manifest = assembleManifest({}, { schema: 99, recipes: [RECIPE] });
  assert.deepEqual(
    manifest.recipes,
    [],
    "guessing at an unknown format on a document that edits a player's client is worse than serving nothing",
  );
});

test("adding recipes does not move the schema version", () => {
  // launcher_core::manifest::Manifest is NOT deny_unknown_fields (only
  // ClientFile is), so an older launcher ignores this array. But validate()
  // rejects any schema != SCHEMA_VERSION, so bumping would break every
  // launcher already in a player's hands to announce a field they ignore.
  const manifest = assembleManifest({}, { schema: 1, recipes: [RECIPE] });
  assert.equal(manifest.schema, 1);
});
