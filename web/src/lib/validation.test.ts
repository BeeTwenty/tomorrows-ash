import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateCharacterName, validateEmail, validatePassword, validateUsername } from "./validation";

test("usernames are uppercased and bounded", () => {
  const ok = validateUsername("  ashen_one ");
  assert.deepEqual(ok, { ok: true, value: "ASHEN_ONE" });
  assert.equal(validateUsername("ab").ok, false);
  assert.equal(validateUsername("a".repeat(17)).ok, false);
  assert.equal(validateUsername("bad name").ok, false);
  assert.equal(validateUsername("drop;table").ok, false);
});

test("passwords respect the client's 16-character ceiling", () => {
  assert.equal(validatePassword("emberfall").ok, true);
  assert.equal(validatePassword("short").ok, false);
  assert.equal(validatePassword("a".repeat(17)).ok, false);
  assert.equal(validatePassword("emberfäll").ok, false, "non-ASCII is rejected");
});

test("a password cannot be the account name, in any case", () => {
  assert.equal(validatePassword("ashen_one", "ASHEN_ONE").ok, false);
  assert.equal(validatePassword("AsHeN_oNe", "ashen_one").ok, false);
});

test("emails are uppercased to match what the core stores", () => {
  assert.deepEqual(validateEmail("Player@Example.com"), { ok: true, value: "PLAYER@EXAMPLE.COM" });
  assert.equal(validateEmail("not-an-email").ok, false);
  assert.equal(validateEmail("", { required: false }).ok, true);
  assert.equal(validateEmail("").ok, false);
});

test("character names are letters only", () => {
  assert.equal(validateCharacterName("Emberlyn").ok, true);
  assert.equal(validateCharacterName("A").ok, false);
  assert.equal(validateCharacterName("Ash Morrow").ok, false);
  assert.equal(validateCharacterName("Ember%").ok, false);
});
