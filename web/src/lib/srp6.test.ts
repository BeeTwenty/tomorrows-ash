import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { MAX_PASSWORD_LENGTH, upperLatin } from "./limits";
import {
  SALT_LENGTH,
  VERIFIER_LENGTH,
  calculateVerifier,
  makeRegistrationData,
  verifyPassword,
} from "./srp6";

test("upperLatin uppercases only basic latin, like Utf8ToUpperOnlyLatin", () => {
  assert.equal(upperLatin("ashmorrow"), "ASHMORROW");
  assert.equal(upperLatin("Ember_42"), "EMBER_42");
  // JS toUpperCase() would turn these into "SS" and "ЖАР" - the core does not.
  assert.equal(upperLatin("straße"), "STRAßE");
  assert.equal(upperLatin("жар"), "жар");
});

test("registration data has the shapes the account table expects", () => {
  const { salt, verifier } = makeRegistrationData("ASHEN", "correct horse");
  assert.equal(salt.length, SALT_LENGTH);
  assert.equal(verifier.length, VERIFIER_LENGTH);
});

test("verifier round-trips: the right password verifies, a wrong one does not", () => {
  const { salt, verifier } = makeRegistrationData("ASHEN", "emberfall");
  assert.equal(verifyPassword("ASHEN", "emberfall", salt, verifier), true);
  assert.equal(verifyPassword("ASHEN", "emberfal", salt, verifier), false);
  assert.equal(verifyPassword("ASHEM", "emberfall", salt, verifier), false);
});

test("username and password are case-insensitive, as they are in the game client", () => {
  const { salt, verifier } = makeRegistrationData("ashen", "Emberfall");
  assert.equal(verifyPassword("ASHEN", "EMBERFALL", salt, verifier), true);
  assert.equal(verifyPassword("AsHeN", "eMbErFaLl", salt, verifier), true);
});

test("known vector: a fixed salt always yields the same verifier", () => {
  // Regression guard, cross-checked against an independent implementation of
  // the same formula. If a byte-order detail ever changes, this fails loudly
  // instead of quietly creating accounts nobody can log into.
  const salt = Buffer.alloc(SALT_LENGTH, 0x11);
  const verifier = calculateVerifier("ASHMORROW", "TOMORROWSASH", salt);
  assert.equal(
    verifier.toString("hex"),
    "13624bc6778a4fbbe1637e831336494fdea028c701ef14b8fcb706ea95a12952",
  );
});

test("a zero-byte salt still produces a full-width verifier", () => {
  const verifier = calculateVerifier("ASHEN", "X", Buffer.alloc(SALT_LENGTH, 0));
  assert.equal(verifier.length, VERIFIER_LENGTH);
});

test("verifyPassword rejects malformed stored data instead of throwing", () => {
  assert.equal(verifyPassword("ASHEN", "x", Buffer.alloc(4), Buffer.alloc(VERIFIER_LENGTH)), false);
  assert.equal(verifyPassword("ASHEN", "x", randomBytes(SALT_LENGTH), Buffer.alloc(3)), false);
});

test("the core's password ceiling is 16 characters", () => {
  assert.equal(MAX_PASSWORD_LENGTH, 16);
});
