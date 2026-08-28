import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeSession, encodeSession, newSessionPayload } from "./session";

test("a signed session decodes back to the same payload", () => {
  const payload = newSessionPayload(42, "ASHEN", "abcdef0123456789");
  const decoded = decodeSession(encodeSession(payload));
  assert.deepEqual(decoded, payload);
});

test("a tampered payload is rejected", () => {
  const token = encodeSession(newSessionPayload(42, "ASHEN", "abcdef0123456789"));
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ aid: 1, u: "ADMIN", fp: "x", exp: 9e9 })).toString("base64url");
  assert.equal(decodeSession(`${forged}.${signature}`), null);
  assert.equal(decodeSession(`${body}.${"a".repeat(signature!.length)}`), null);
});

test("garbage and empty input are rejected without throwing", () => {
  assert.equal(decodeSession(undefined), null);
  assert.equal(decodeSession(""), null);
  assert.equal(decodeSession("nodot"), null);
  assert.equal(decodeSession(".onlysig"), null);
});

test("an expired session is rejected", () => {
  const expired = { aid: 1, u: "ASHEN", fp: "abc", exp: Math.floor(Date.now() / 1000) - 60 };
  assert.equal(decodeSession(encodeSession(expired)), null);
});
