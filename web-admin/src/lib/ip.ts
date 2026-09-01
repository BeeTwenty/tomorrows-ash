/**
 * Client address resolution and allowlisting.
 *
 * The panel is reachable over the public internet, so the allowlist is a real
 * control rather than a formality - which means the address it checks has to be
 * one the client could not have chosen.
 *
 * `X-Forwarded-For` is client-controlled. A request can arrive carrying
 * `X-Forwarded-For: <an allowlisted address>` and, if the proxy *appends*
 * rather than overwrites, the value the client invented sits at the head of the
 * list. Reading the first entry would hand anyone on the internet a way past
 * the allowlist.
 *
 * So this module counts hops from the **right**: the rightmost entry was added
 * by our own proxy, and each trusted hop peels one more off. `TRUSTED_PROXY_HOPS`
 * is the number of proxies we control between the client and this process
 * (normally 1). Anything the client prepended stays to the left of that and is
 * never read.
 *
 * With no trusted proxy configured there is no trustworthy source at all, and
 * this returns null. Callers treat null as "deny" whenever an allowlist exists.
 */

export interface AddressPolicy {
  trustedProxyHops: number;
  /** A header the proxy is configured to OVERWRITE, e.g. X-Real-IP. */
  realIpHeader: string | null;
}

export type HeaderLookup = (name: string) => string | null | undefined;

/**
 * The address to hold the client to, or null when none can be trusted.
 */
export function resolveClientAddress(headers: HeaderLookup, policy: AddressPolicy): string | null {
  if (policy.realIpHeader) {
    const direct = headers(policy.realIpHeader)?.trim();
    if (direct) return normaliseAddress(direct);
  }

  if (policy.trustedProxyHops < 1) return null;

  const forwarded = headers("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // The rightmost entry came from the proxy nearest to us. Peel off exactly as
  // many as we actually operate; the client cannot reach past that.
  const index = hops.length - policy.trustedProxyHops;
  const candidate = hops[index];
  return candidate ? normaliseAddress(candidate) : null;
}

/** Strip a port, brackets, and the IPv4-mapped IPv6 prefix proxies often add. */
export function normaliseAddress(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close > 0) value = value.slice(1, close);
  } else if (value.includes(".") && value.includes(":")) {
    // IPv4 with a port. An IPv6 address has more than one colon.
    const parts = value.split(":");
    if (parts.length === 2) value = parts[0]!;
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  return (mapped?.[1] ?? value).toLowerCase();
}

function ipv4ToBigInt(address: string): bigint | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function ipv6ToBigInt(address: string): bigint | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const expand = (segment: string): string[] => (segment ? segment.split(":").filter(Boolean) : []);
  let head = expand(halves[0] ?? "");
  const tail = halves.length === 2 ? expand(halves[1] ?? "") : [];

  // A trailing IPv4 literal, as in ::ffff:192.0.2.1
  const last = (tail.length ? tail : head)[Math.max(0, (tail.length ? tail : head).length - 1)];
  if (last && last.includes(".")) {
    const v4 = ipv4ToBigInt(last);
    if (v4 === null) return null;
    const high = (v4 >> 16n) & 0xffffn;
    const low = v4 & 0xffffn;
    const replacement = [high.toString(16), low.toString(16)];
    if (tail.length) tail.splice(-1, 1, ...replacement);
    else head.splice(-1, 1, ...replacement);
  }

  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  if (halves.length === 1 && missing !== 0) return null;
  head = [...head, ...Array(missing).fill("0"), ...tail];

  let value = 0n;
  for (const group of head) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

interface ParsedAddress {
  value: bigint;
  bits: 32 | 128;
}

export function parseAddress(raw: string): ParsedAddress | null {
  const address = normaliseAddress(raw);
  if (address.includes(":")) {
    const value = ipv6ToBigInt(address);
    return value === null ? null : { value, bits: 128 };
  }
  const value = ipv4ToBigInt(address);
  return value === null ? null : { value, bits: 32 };
}

/**
 * Does an address fall inside a rule? A rule is a plain address or CIDR.
 * A malformed rule never matches - it does not throw and it does not allow.
 */
export function addressMatches(address: string, rule: string): boolean {
  const parsedAddress = parseAddress(address);
  if (!parsedAddress) return false;

  const [network, prefixText] = rule.trim().split("/");
  if (!network) return false;

  const parsedNetwork = parseAddress(network);
  if (!parsedNetwork || parsedNetwork.bits !== parsedAddress.bits) return false;

  const prefix = prefixText === undefined ? parsedNetwork.bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsedNetwork.bits) return false;

  const hostBits = BigInt(parsedNetwork.bits - prefix);
  const mask = hostBits === 0n ? ~0n : ~((1n << hostBits) - 1n);
  return (parsedAddress.value & mask) === (parsedNetwork.value & mask);
}

export interface AllowlistVerdict {
  allowed: boolean;
  address: string | null;
  reason: string;
}

/**
 * The allowlist decision, fail-closed.
 *
 * An empty allowlist means "no restriction" and is only reachable when the
 * deployment has declared itself private - `env.ts` refuses to start a public
 * instance without one, so this function is never the only thing standing
 * between the internet and the panel.
 */
export function checkAllowlist(address: string | null, allowlist: string[]): AllowlistVerdict {
  if (allowlist.length === 0) {
    return { allowed: true, address, reason: "no allowlist configured" };
  }
  if (!address) {
    return {
      allowed: false,
      address: null,
      reason: "no trustworthy client address (check TRUSTED_PROXY_HOPS and the proxy's headers)",
    };
  }
  const matched = allowlist.some((rule) => addressMatches(address, rule));
  return {
    allowed: matched,
    address,
    reason: matched ? "address is allowlisted" : "address is not on the allowlist",
  };
}

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
