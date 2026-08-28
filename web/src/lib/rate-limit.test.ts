import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RATE_RULES, _resetMemoryBuckets, consume, consumeAll } from "./rate-limit";

test("a bucket allows exactly `limit` attempts, then blocks", async () => {
  _resetMemoryBuckets();
  const rule = { limit: 3, windowSeconds: 60 };
  const verdicts = [];
  for (let i = 0; i < 5; i += 1) verdicts.push(await consume("test:a", rule));
  assert.deepEqual(
    verdicts.map((v) => v.allowed),
    [true, true, true, false, false],
  );
  assert.ok(verdicts[3]!.retryAfter > 0, "a blocked attempt reports when to retry");
});

test("buckets are independent", async () => {
  _resetMemoryBuckets();
  const rule = { limit: 1, windowSeconds: 60 };
  assert.equal((await consume("test:one", rule)).allowed, true);
  assert.equal((await consume("test:two", rule)).allowed, true);
  assert.equal((await consume("test:one", rule)).allowed, false);
});

test("consumeAll blocks when any single bucket is exhausted", async () => {
  _resetMemoryBuckets();
  const generous = { limit: 10, windowSeconds: 60 };
  const strict = { limit: 1, windowSeconds: 60 };
  await consume("test:ip", generous);
  await consume("test:id", strict);
  const verdict = await consumeAll([
    { key: "test:ip", rule: generous },
    { key: "test:id", rule: strict },
  ]);
  assert.equal(verdict.allowed, false);
});

test("login is limited more tightly per identity than per address", () => {
  assert.ok(RATE_RULES.loginIdentity.limit < RATE_RULES.login.limit);
});
