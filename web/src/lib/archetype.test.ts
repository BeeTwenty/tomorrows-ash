import { strict as assert } from "node:assert";
import { test } from "node:test";
import { composeArchetype } from "./archetype";

test("an empty build is Unkindled", () => {
  const archetype = composeArchetype([]);
  assert.equal(archetype.title, "Unkindled");
  assert.equal(archetype.shape, "unspent");
  assert.equal(composeArchetype([{ name: "Fire", points: 0 }]).shape, "unspent");
});

test("a build poured into one tree gets that tree's solo title", () => {
  const archetype = composeArchetype([
    { name: "Fire", points: 30 },
    { name: "Sword Mastery", points: 2 },
  ]);
  assert.equal(archetype.title, "Pyresworn");
  assert.equal(archetype.shape, "focused");
  assert.equal(archetype.descriptor, "Fire");
});

test("two dominant trees compound into one word, and order matters", () => {
  assert.equal(
    composeArchetype([
      { name: "Fire", points: 20 },
      { name: "Sword Mastery", points: 15 },
    ]).title,
    "Emberblade",
  );
  assert.equal(
    composeArchetype([
      { name: "Sword Mastery", points: 20 },
      { name: "Fire", points: 15 },
    ]).title,
    "Steelflame",
  );
});

test("points spread thin read as Cinderwake", () => {
  const archetype = composeArchetype([
    { name: "Fire", points: 10 },
    { name: "Frost", points: 9 },
    { name: "Stealth", points: 8 },
    { name: "Shield", points: 7 },
  ]);
  assert.equal(archetype.title, "Cinderwake");
  assert.equal(archetype.shape, "broad");
  assert.match(archetype.descriptor, /Fire · Frost · Stealth/);
});

test("tree names the lexicon has never seen still get a title", () => {
  assert.equal(
    composeArchetype([{ name: "Runecarving", points: 20 }]).title,
    "Runecarving-sworn",
  );
  assert.equal(
    composeArchetype([
      { name: "Runecarving", points: 18 },
      { name: "Tinkering", points: 14 },
    ]).title,
    "Twinbrand",
  );
});

test("the summary always describes the actual spread", () => {
  const archetype = composeArchetype([
    { name: "Frost", points: 24 },
    { name: "Stealth", points: 16 },
  ]);
  assert.match(archetype.summary, /24 in Frost/);
  assert.match(archetype.summary, /16 in Stealth/);
});
