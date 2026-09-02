import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne, schema } from "./db";
import { env } from "./env";
import { MINIMUM_PANEL_LEVEL, roleForLevel, type Actor, type Role } from "./roles";

/**
 * Admin sessions: stateful and revocable.
 *
 * The public site uses a stateless signed cookie, which is right for a player
 * account - there is nothing to revoke that a password change does not already
 * handle. It is wrong here. A staff session must be killable *now*: from
 * another browser, by another administrator, or by the demotion of the person
 * holding it. A signed cookie cannot be taken back, so the panel keeps rows.
 *
 * What the cookie carries is a random 256-bit token plus an HMAC tag. The tag
 * is not the security boundary - the token's entropy is - it exists so that a
 * flood of forged cookies is refused by a hash comparison instead of a database
 * round trip. The row is keyed by SHA-256 of the token, never the token itself,
 * so read access to `admin_session` does not hand anyone a working cookie.
 *
 * Four independent things can end a session, and all four are checked on every
 * request:
 *
 *   1. `revoked_at` is set (explicit sign-out, or another admin killing it).
 *   2. `expires_at` has passed - the absolute lifetime, however active you are.
 *   3. `last_seen_at` is older than the idle window.
 *   4. The account no longer backs it: the SRP6 verifier changed (password
 *      reset), or `account_access.gmlevel` dropped below the panel's floor.
 *
 * (4) is why `gmLevel` on the Actor is documented as read fresh. Demoting
 * someone in the panel logs them out of the panel on their next click, rather
 * than at their next login, which could be never.
 */

const COOKIE_SECURE = "__Host-ash_admin";
const COOKIE_PLAIN = "ash_admin_session";

export const adminCookieName = env.secureCookies ? COOKIE_SECURE : COOKIE_PLAIN;

/**
 * Where a session is in the login sequence.
 *
 * Password and TOTP are two steps, so the half-authenticated state between them
 * has to live somewhere. Putting it in the same table as a real session - with
 * a stage column that every guard checks - means there is exactly one thing to
 * revoke and one place where "is this session allowed to do work" is decided.
 * A second cookie for the intermediate state would be a second thing to get
 * wrong.
 */
export type SessionStage = "pending_totp" | "pending_enrolment" | "active";

/** A session that has passed every check, including the stage check. */
export interface AdminSession {
  id: string;
  actor: Actor;
  stage: SessionStage;
  createdAt: Date;
  expiresAt: Date;
  address: string | null;
}

export type SessionFailure =
  | "none"
  | "invalid"
  | "expired"
  | "idle"
  | "revoked"
  | "address"
  | "credentials_changed"
  | "not_staff";

export type SessionLookup =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: SessionFailure };

interface SessionRow extends RowDataPacket {
  id: string;
  account_id: number;
  username: string;
  stage: SessionStage;
  verifier_fp: string;
  address: string | null;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}

interface AccountStateRow extends RowDataPacket {
  username: string;
  verifier: Buffer;
  gmlevel: number | null;
}

export function accountFingerprint(verifier: Buffer): string {
  return createHash("sha256").update(verifier).digest("hex").slice(0, 16);
}

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tag(token: string): string {
  return createHmac("sha256", env.security.sessionSecret).update(token).digest("base64url").slice(0, 27);
}

function splitCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;

  const token = value.slice(0, dot);
  const provided = value.slice(dot + 1);
  const expected = tag(token);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  return token;
}

/**
 * The account's current standing, read from the auth database rather than the
 * session row. `account_access.RealmID` is -1 for "every realm", and an account
 * can hold rows for both, so the effective level is the highest that applies.
 */
export async function readAccountStanding(accountId: number): Promise<
  { username: string; verifierFingerprint: string; gmLevel: number } | null
> {
  const row = await queryOne<AccountStateRow>(
    `SELECT a.username AS username,
            a.verifier AS verifier,
            (SELECT MAX(aa.gmlevel)
               FROM ${schema.auth}.\`account_access\` aa
              WHERE aa.id = a.id AND (aa.RealmID = -1 OR aa.RealmID = ?)) AS gmlevel
       FROM ${schema.auth}.\`account\` a
      WHERE a.id = ?
      LIMIT 1`,
    [env.realm.id, accountId],
  );
  if (!row) return null;

  return {
    username: row.username,
    verifierFingerprint: accountFingerprint(row.verifier),
    gmLevel: row.gmlevel ?? 0,
  };
}

export interface CreateSessionInput {
  accountId: number;
  username: string;
  verifierFingerprint: string;
  stage: SessionStage;
  address: string | null;
  userAgent: string | null;
}

/** Mint a session row and return the raw cookie value. Written once, never re-read. */
export async function createSession(input: CreateSessionInput): Promise<{ cookie: string; id: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const id = tokenId(token);
  const expiresAt = new Date(Date.now() + env.access.sessionHours * 3_600_000);

  await execute(
    `INSERT INTO ${schema.admin}.\`admin_session\`
       (id, account_id, username, stage, verifier_fp, address, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
    [
      id,
      input.accountId,
      input.username.slice(0, 32),
      input.stage,
      input.verifierFingerprint,
      input.address?.slice(0, 45) ?? null,
      input.userAgent?.slice(0, 255) ?? null,
      expiresAt,
    ],
  );

  return { cookie: `${token}.${tag(token)}`, id, expiresAt };
}

export async function promoteSession(id: string, stage: SessionStage): Promise<void> {
  await execute(
    `UPDATE ${schema.admin}.\`admin_session\` SET stage = ?, last_seen_at = NOW() WHERE id = ? AND revoked_at IS NULL`,
    [stage, id],
  );
}

export async function revokeSession(id: string, reason: string): Promise<void> {
  await execute(
    `UPDATE ${schema.admin}.\`admin_session\`
        SET revoked_at = NOW(), revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [reason.slice(0, 64), id],
  );
}

/**
 * Kill every live session an account has.
 *
 * Called on demotion, on ban, and on a staff password reset. It is deliberately
 * not restricted to "other" sessions: an administrator who resets their own
 * password should be signed out everywhere, including here.
 */
export async function revokeSessionsForAccount(accountId: number, reason: string): Promise<number> {
  const result = await execute(
    `UPDATE ${schema.admin}.\`admin_session\`
        SET revoked_at = NOW(), revoked_reason = ?
      WHERE account_id = ? AND revoked_at IS NULL AND expires_at > NOW()`,
    [reason.slice(0, 64), accountId],
  );
  return result.affectedRows;
}

export interface SessionSummary {
  id: string;
  accountId: number;
  username: string;
  stage: SessionStage;
  address: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

/** Live sessions, newest first - the "who is signed in right now" view. */
export async function listLiveSessions(limit = 100): Promise<SessionSummary[]> {
  const rows = await query<SessionRow & { user_agent: string | null }>(
    `SELECT id, account_id, username, stage, address, user_agent, created_at, last_seen_at, expires_at
       FROM ${schema.admin}.\`admin_session\`
      WHERE revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_seen_at DESC
      LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`,
  );

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    username: row.username,
    stage: row.stage,
    address: row.address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  }));
}

/** Writing last_seen_at on every request would be a write per page view. */
const TOUCH_INTERVAL_MS = 60_000;

async function touch(id: string, lastSeen: Date): Promise<void> {
  if (Date.now() - lastSeen.getTime() < TOUCH_INTERVAL_MS) return;
  await execute(`UPDATE ${schema.admin}.\`admin_session\` SET last_seen_at = NOW() WHERE id = ?`, [id]);
}

/**
 * Resolve the cookie into a session, or say why not.
 *
 * The caller gets a reason rather than a null so the sign-in page can tell the
 * difference between "you were never here" and "you were signed out because
 * your password changed" - and so the audit log records which.
 */
export async function loadSession(address: string | null): Promise<SessionLookup> {
  const store = await cookies();
  const token = splitCookie(store.get(adminCookieName)?.value);
  if (!token) return { ok: false, reason: "none" };

  const id = tokenId(token);
  const row = await queryOne<SessionRow>(
    `SELECT id, account_id, username, stage, verifier_fp, address, created_at, expires_at, last_seen_at, revoked_at
       FROM ${schema.admin}.\`admin_session\`
      WHERE id = ?
      LIMIT 1`,
    [id],
  );

  if (!row) return { ok: false, reason: "invalid" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const idleMs = env.access.idleMinutes * 60_000;
  if (Date.now() - row.last_seen_at.getTime() > idleMs) {
    await revokeSession(id, "idle");
    return { ok: false, reason: "idle" };
  }

  /**
   * Address pinning. This would be too aggressive for a player session, where
   * a phone switching from wifi to cellular is normal. It is right here: the
   * panel is already restricted to an allowlist of fixed addresses, so a
   * session whose address changed mid-flight has either been stolen or is
   * coming through a proxy the operator did not declare. Both are worth an
   * interruption.
   */
  if (row.address && address && row.address !== address) {
    await revokeSession(id, "address-changed");
    return { ok: false, reason: "address" };
  }

  const standing = await readAccountStanding(row.account_id);
  if (!standing) {
    await revokeSession(id, "account-gone");
    return { ok: false, reason: "invalid" };
  }
  if (standing.verifierFingerprint !== row.verifier_fp) {
    await revokeSession(id, "credentials-changed");
    return { ok: false, reason: "credentials_changed" };
  }

  const role: Role | null = roleForLevel(standing.gmLevel);
  if (!role || standing.gmLevel < MINIMUM_PANEL_LEVEL) {
    await revokeSession(id, "not-staff");
    return { ok: false, reason: "not_staff" };
  }

  await touch(id, row.last_seen_at);

  return {
    ok: true,
    session: {
      id: row.id,
      stage: row.stage,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      address: row.address,
      actor: {
        accountId: row.account_id,
        username: standing.username,
        gmLevel: standing.gmLevel,
        role,
      },
    },
  };
}

export async function writeSessionCookie(cookie: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(adminCookieName, cookie, {
    httpOnly: true,
    // The panel has no cross-site flows at all - no OAuth callback, no embedded
    // form posts - so nothing needs the cookie to survive a cross-site
    // navigation. Strict costs nothing here and removes a class of CSRF.
    sameSite: "strict",
    secure: env.secureCookies,
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(adminCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: env.secureCookies,
    path: "/",
    maxAge: 0,
  });
}

/** Housekeeping. Rows are kept briefly after death so the log can explain them. */
export async function pruneSessions(keepDays = 7): Promise<number> {
  const result = await execute(
    `DELETE FROM ${schema.admin}.\`admin_session\`
      WHERE expires_at < (NOW() - INTERVAL ? DAY)`,
    [Math.max(1, Math.trunc(keepDays))],
  );
  return result.affectedRows;
}
