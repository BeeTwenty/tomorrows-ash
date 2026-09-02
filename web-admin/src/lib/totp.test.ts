import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  base32Decode,
  base32Encode,
  codeForStep,
  currentStep,
  enrolmentUri,
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  verifyCode,
} from "./totp";

// RFC 6238 appendix B: the seed "12345678901234567890" with SHA-1.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("matches the RFC 6238 published test vectors", () => {
  // (unix time, expected 6-digit truncation of the 8-digit RFC value)
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [seconds, expected] of vectors) {
    const step = Math.floor(seconds / 30);
    assert.equal(codeForStep(RFC_SECRET, step), expected, `t=${seconds}`);
  }
});

test("base32 round-trips", () => {
  const original = Buffer.from("12345678901234567890", "ascii");
  assert.deepEqual(base32Decode(base32Encode(original)), original);
  assert.equal(base32Decode("not base32!"), null);
  assert.equal(base32Decode(""), null);
});

test("a current code verifies and reports its step", () => {
  const atMs = 1_700_000_000_000;
  const step = currentStep(atMs);
  const code = codeForStep(RFC_SECRET, step)!;
  const result = verifyCode(RFC_SECRET, code, { atMs });
  assert.equal(result.ok, true);
  assert.equal(result.step, step);
});

test("clock drift of one step either way is tolerated", () => {
  const atMs = 1_700_000_000_000;
  const step = currentStep(atMs);
  for (const drift of [-1, 0, 1]) {
    const code = codeForStep(RFC_SECRET, step + drift)!;
    assert.equal(verifyCode(RFC_SECRET, code, { atMs }).ok, true, `drift ${drift}`);
  }
  const tooOld = codeForStep(RFC_SECRET, step - 2)!;
  assert.equal(verifyCode(RFC_SECRET, tooOld, { atMs }).ok, false, "two steps out is refused");
});

test("a code cannot be replayed within its window", () => {
  const atMs = 1_700_000_000_000;
  const step = currentStep(atMs);
  const code = codeForStep(RFC_SECRET, step)!;

  const first = verifyCode(RFC_SECRET, code, { atMs });
  assert.equal(first.ok, true);

  const replay = verifyCode(RFC_SECRET, code, { atMs, lastUsedStep: first.step });
  assert.equal(replay.ok, false, "the same code must not work twice");
  assert.equal(replay.reason, "code already used");
});

test("an older code is refused once a newer one has been used", () => {
  const atMs = 1_700_000_000_000;
  const step = currentStep(atMs);
  const previous = codeForStep(RFC_SECRET, step - 1)!;
  assert.equal(verifyCode(RFC_SECRET, previous, { atMs, lastUsedStep: step }).ok, false);
});

test("malformed input is refused without throwing", () => {
  const atMs = 1_700_000_000_000;
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56x"]) {
    assert.equal(verifyCode(RFC_SECRET, bad, { atMs }).ok, false, `code ${JSON.stringify(bad)}`);
  }
  assert.equal(verifyCode("not-base32!", "123456", { atMs }).ok, false);
});

test("generated secrets are usable and distinct", () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.notEqual(a, b);
  assert.ok(codeForStep(a, 1)!.length === 6);
});

test("the enrolment URI carries what an authenticator needs", () => {
  const uri = enrolmentUri("ABCDEFGHIJKLMNOP", "ASHADMIN");
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=ABCDEFGHIJKLMNOP/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

test("recovery codes are distinct and normalise for comparison", () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(new Set(codes).size, 10);
  assert.equal(normaliseRecoveryCode("a1b2-c3d4"), "A1B2C3D4");
  assert.equal(normaliseRecoveryCode(" A1B2 C3D4 "), "A1B2C3D4");
});
