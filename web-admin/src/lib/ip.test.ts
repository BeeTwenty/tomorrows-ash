import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addressMatches,
  checkAllowlist,
  normaliseAddress,
  parseAllowlist,
  resolveClientAddress,
  type HeaderLookup,
} from "./ip";

const headersFrom = (map: Record<string, string>): HeaderLookup =>
  (name) => map[name.toLowerCase()] ?? null;

test("a client cannot spoof its way past the allowlist by prepending X-Forwarded-For", () => {
  // The attacker sends "X-Forwarded-For: 10.0.0.5" (an allowlisted address).
  // Our single proxy appends the real address, so the list becomes:
  //   10.0.0.5, 203.0.113.9
  // Reading the FIRST entry would trust the attacker. We read from the right.
  const headers = headersFrom({ "x-forwarded-for": "10.0.0.5, 203.0.113.9" });
  const address = resolveClientAddress(headers, { trustedProxyHops: 1, realIpHeader: null });
  assert.equal(address, "203.0.113.9", "the address must come from our own proxy, not the client");
  assert.equal(checkAllowlist(address, ["10.0.0.0/8"]).allowed, false);
});

test("two trusted proxies peel two hops", () => {
  const headers = headersFrom({ "x-forwarded-for": "10.0.0.5, 203.0.113.9, 198.51.100.7" });
  assert.equal(resolveClientAddress(headers, { trustedProxyHops: 2, realIpHeader: null }), "203.0.113.9");
});

test("with no trusted proxy there is no trustworthy address, and that denies", () => {
  const headers = headersFrom({ "x-forwarded-for": "203.0.113.9" });
  const address = resolveClientAddress(headers, { trustedProxyHops: 0, realIpHeader: null });
  assert.equal(address, null);
  const verdict = checkAllowlist(address, ["203.0.113.0/24"]);
  assert.equal(verdict.allowed, false, "an unknown address must never satisfy an allowlist");
  assert.match(verdict.reason, /no trustworthy client address/);
});

test("a proxy-set real-ip header wins over the forwarded chain", () => {
  const headers = headersFrom({
    "x-forwarded-for": "10.0.0.5, 203.0.113.9",
    "x-real-ip": "198.51.100.7",
  });
  assert.equal(
    resolveClientAddress(headers, { trustedProxyHops: 1, realIpHeader: "x-real-ip" }),
    "198.51.100.7",
  );
});

test("asking for more hops than exist yields nothing rather than the client's own entry", () => {
  const headers = headersFrom({ "x-forwarded-for": "10.0.0.5" });
  assert.equal(resolveClientAddress(headers, { trustedProxyHops: 3, realIpHeader: null }), null);
});

test("addresses are normalised: ports, brackets and IPv4-mapped IPv6", () => {
  assert.equal(normaliseAddress("203.0.113.9:44321"), "203.0.113.9");
  assert.equal(normaliseAddress("[2001:db8::1]"), "2001:db8::1");
  assert.equal(normaliseAddress("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(normaliseAddress("  198.51.100.7 "), "198.51.100.7");
});

test("IPv4 CIDR matching", () => {
  assert.equal(addressMatches("203.0.113.9", "203.0.113.0/24"), true);
  assert.equal(addressMatches("203.0.114.9", "203.0.113.0/24"), false);
  assert.equal(addressMatches("203.0.113.9", "203.0.113.9"), true, "a bare address is a /32");
  assert.equal(addressMatches("203.0.113.9", "203.0.113.8"), false);
  assert.equal(addressMatches("10.1.2.3", "0.0.0.0/0"), true);
});

test("IPv6 CIDR matching, including mapped IPv4", () => {
  assert.equal(addressMatches("2001:db8::1", "2001:db8::/32"), true);
  assert.equal(addressMatches("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(addressMatches("::ffff:203.0.113.9", "203.0.113.0/24"), true,
    "a mapped address is compared as the IPv4 it is");
});

test("families never cross-match", () => {
  assert.equal(addressMatches("203.0.113.9", "2001:db8::/32"), false);
  assert.equal(addressMatches("2001:db8::1", "203.0.113.0/24"), false);
});

test("a malformed rule or address denies rather than throwing or allowing", () => {
  for (const rule of ["", "not-an-ip", "203.0.113.0/33", "203.0.113.0/-1", "203.0.113.0/abc", "999.1.1.1"]) {
    assert.equal(addressMatches("203.0.113.9", rule), false, `rule ${JSON.stringify(rule)} must not match`);
  }
  assert.equal(addressMatches("garbage", "203.0.113.0/24"), false);
});

test("an empty allowlist is only 'no restriction', never an accidental deny", () => {
  const verdict = checkAllowlist("203.0.113.9", []);
  assert.equal(verdict.allowed, true);
  assert.match(verdict.reason, /no allowlist/);
});

test("allowlists parse from the environment format", () => {
  assert.deepEqual(parseAllowlist(" 203.0.113.0/24 , 10.0.0.1 ,, "), ["203.0.113.0/24", "10.0.0.1"]);
  assert.deepEqual(parseAllowlist(""), []);
});
