import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatDuration, formatMoney, formatPlayed, formatRelative } from "./format";

test("durations shrink to the largest useful unit", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(90), "1m");
  assert.equal(formatDuration(3_600 * 4 + 720), "4h 12m");
  assert.equal(formatDuration(86_400 * 3 + 3_600 * 4), "3d 04h");
});

test("missing or nonsensical durations render as an em dash, not NaN", () => {
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(undefined), "—");
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDuration(-5), "—");
});

test("played time reads in the largest sensible unit", () => {
  assert.equal(formatPlayed(0), "no time played");
  assert.equal(formatPlayed(86_400 * 2), "2.0 days played");
  assert.equal(formatPlayed(3_600 * 5), "5.0 hours played");
  assert.equal(formatPlayed(600), "10 minutes played");
});

test("relative times are stable against an injected clock", () => {
  const now = new Date("2026-08-25T12:00:00Z");
  assert.equal(formatRelative(new Date("2026-08-25T11:59:30Z"), now), "just now");
  assert.equal(formatRelative(new Date("2026-08-25T09:00:00Z"), now), "3 hours ago");
  assert.equal(formatRelative(null, now), "never");
});

test("money splits into gold, silver and copper", () => {
  assert.equal(formatMoney(0), "0g 00s 00c");
  assert.equal(formatMoney(123_456), "12g 34s 56c");
});
