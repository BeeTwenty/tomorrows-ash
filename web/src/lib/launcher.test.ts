import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleManifest } from "./launcher";
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
