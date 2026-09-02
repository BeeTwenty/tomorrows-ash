import assert from "node:assert/strict";
import { test } from "node:test";
import { seal, unseal } from "./secretbox";

test("a sealed secret round-trips", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  assert.equal(unseal(seal(secret)), secret);
});

test("two seals of the same secret differ", () => {
  // A fixed IV would let anyone with the table see which staff share a secret.
  assert.notEqual(seal("JBSWY3DPEHPK3PXP"), seal("JBSWY3DPEHPK3PXP"));
});

test("a tampered ciphertext does not decrypt", () => {
  const sealed = seal("JBSWY3DPEHPK3PXP");
  const parts = sealed.split(":");
  const body = Buffer.from(parts[3]!, "base64url");
  body[0] = (body[0]! ^ 0xff) & 0xff;
  parts[3] = body.toString("base64url");
  assert.equal(unseal(parts.join(":")), null);
});

test("a truncated or foreign value is rejected rather than thrown on", () => {
  assert.equal(unseal(""), null);
  assert.equal(unseal("v1:aaa"), null);
  assert.equal(unseal("v2:a:b:c"), null);
  assert.equal(unseal("not-sealed-at-all"), null);
});
