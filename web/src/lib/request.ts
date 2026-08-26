import { headers } from "next/headers";
import { env } from "./env";

/**
 * Where a request came from, for rate limiting and the audit log.
 *
 * Next.js does not expose the socket address to Server Actions, so behind a
 * reverse proxy `TRUST_PROXY=1` makes `X-Forwarded-For` authoritative. With it
 * off, a forged header cannot buy a fresh rate-limit bucket - every request
 * without a trusted address shares one. That is deliberately conservative:
 * legitimate players still get their per-identity budget, and an attacker
 * cannot dodge limits by inventing addresses.
 */
export async function clientAddress(): Promise<string> {
  const h = await headers();

  if (env.security.trustProxy) {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = h.get("x-real-ip")?.trim();
    if (real) return real;
  }

  return "untrusted-origin";
}

/** account.last_ip is varchar(15) - only a plain IPv4 literal fits. */
export function ipv4OrEmpty(address: string): string {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address) && address.length <= 15 ? address : "";
}

/**
 * Reject cross-site form posts.
 *
 * Next.js already compares Origin against Host for Server Actions; doing it
 * again here is cheap, covers Route Handlers too, and keeps the guarantee
 * visible in our own code rather than resting on a framework default.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return; // Same-origin form posts from older clients omit it.

  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Request has no Host header.");

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("Request has a malformed Origin header.");
  }

  if (originHost !== host) {
    throw new Error("Cross-origin form submission refused.");
  }
}
