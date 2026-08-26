import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Stateless, signed session cookies.
 *
 * The cookie carries the account id, its name, and a fingerprint of the
 * account's current SRP6 verifier. Because the fingerprint is re-checked
 * against the database on every authenticated request, changing a password
 * invalidates every session that account had open - including the attacker's,
 * which is the entire point of letting a player change their password.
 *
 * There is no server-side session table to grow, replicate or clean up.
 */

const COOKIE_SECURE = "__Host-ash_session";
const COOKIE_PLAIN = "ash_session";

export const sessionCookieName = env.secureCookies ? COOKIE_SECURE : COOKIE_PLAIN;

export interface SessionPayload {
  /** account.id */
  aid: number;
  /** account.username, uppercase */
  u: string;
  /** First 16 hex chars of SHA-256 over the account's verifier. */
  fp: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", env.security.sessionSecret).update(payload).digest("base64url");
}

export function encodeSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);

  // Length check first: timingSafeEqual throws on a mismatch.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      typeof parsed.aid !== "number" ||
      typeof parsed.u !== "string" ||
      typeof parsed.fp !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp * 1000 <= Date.now()) return null;
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

export function newSessionPayload(aid: number, username: string, fingerprint: string): SessionPayload {
  return {
    aid,
    u: username,
    fp: fingerprint,
    exp: Math.floor(Date.now() / 1000) + env.security.sessionDays * 86_400,
  };
}

/** Read the session cookie. Does not verify it against the database. */
export async function readSessionCookie(): Promise<SessionPayload | null> {
  const store = await cookies();
  return decodeSession(store.get(sessionCookieName)?.value);
}

export async function writeSessionCookie(payload: SessionPayload): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName, encodeSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.secureCookies,
    path: "/",
    expires: new Date(payload.exp * 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.secureCookies,
    path: "/",
    maxAge: 0,
  });
}
