import type { RowDataPacket } from "mysql2";
import { verifyPassword } from "@shared/srp6";
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, upperLatin } from "@shared/limits";
import { audit } from "./audit";
import { execute, query, queryOne, schema } from "./db";
import { env } from "./env";
import { MINIMUM_PANEL_LEVEL, roleForLevel, type Actor } from "./roles";
import { accountFingerprint, createSession, writeSessionCookie, type SessionStage } from "./session";
import { mfaState } from "./mfa";

/**
 * Signing in.
 *
 * Identity comes from the game account - the same username, the same SRP6
 * verifier, the same 16-character limits the 3.3.5a client imposes. Staff do
 * not get a second set of credentials to lose, and an account disabled in the
 * game is disabled here by the same act.
 *
 * Authorisation does not come from the password. It comes from
 * `account_access.gmlevel`, read after the password is verified and re-read on
 * every subsequent request. A correct password for a level-0 account gets the
 * same answer as a wrong one.
 *
 * The sequence is password, then TOTP, then a session that can do work. Both
 * steps are throttled, and both throttles count two things: attempts from an
 * address and attempts against a username. One address trying forty accounts
 * and forty addresses trying one account are different attacks, and a limiter
 * that watches only one of them misses the other.
 */

export type LoginStage = "password" | "totp" | "recovery";

export type LoginResult =
  | { ok: true; stage: SessionStage; actor: Actor }
  | { ok: false; reason: string; retryAfterMinutes?: number };

interface CredentialRow extends RowDataPacket {
  id: number;
  username: string;
  salt: Buffer;
  verifier: Buffer;
  locked: number;
  gmlevel: number | null;
  banned: number;
}

/**
 * One deliberately vague message for every credential failure.
 *
 * "No such account", "wrong password" and "not staff" are three different
 * facts, and the panel should confirm none of them. An attacker who cannot
 * tell a real staff username from a typo has to guess both halves at once.
 */
const VAGUE = "Those credentials are not valid for this panel.";

export async function recordAttempt(
  stage: LoginStage,
  successful: boolean,
  address: string | null,
  username: string | null,
): Promise<void> {
  await execute(
    `INSERT INTO ${schema.admin}.\`admin_login_attempt\` (address, username, stage, successful)
     VALUES (?, ?, ?, ?)`,
    [address?.slice(0, 45) ?? null, username?.slice(0, 32) ?? null, stage, successful ? 1 : 0],
  );
}

export interface ThrottleVerdict {
  blocked: boolean;
  retryAfterMinutes: number;
}

export async function checkThrottle(address: string | null, username: string | null): Promise<ThrottleVerdict> {
  const windowMinutes = env.access.loginWindowMinutes;
  const limit = env.access.loginAttempts;

  const rows = await query<RowDataPacket & { by_address: number; by_username: number }>(
    `SELECT
       SUM(CASE WHEN address = ? THEN 1 ELSE 0 END)  AS by_address,
       SUM(CASE WHEN username = ? THEN 1 ELSE 0 END) AS by_username
     FROM ${schema.admin}.\`admin_login_attempt\`
     WHERE successful = 0 AND at > (NOW() - INTERVAL ? MINUTE)`,
    [address ?? "", username ?? "", windowMinutes],
  );

  const byAddress = Number(rows[0]?.by_address ?? 0);
  const byUsername = Number(rows[0]?.by_username ?? 0);

  return {
    blocked: byAddress >= limit || byUsername >= limit,
    retryAfterMinutes: windowMinutes,
  };
}

/**
 * Step one. A correct password produces a *half* session, never a working one.
 */
export async function signInWithPassword(input: {
  username: string;
  password: string;
  address: string | null;
  userAgent: string | null;
}): Promise<LoginResult> {
  const username = upperLatin(input.username.trim()).slice(0, MAX_USERNAME_LENGTH);
  const password = input.password.slice(0, MAX_PASSWORD_LENGTH);

  const throttle = await checkThrottle(input.address, username);
  if (throttle.blocked) {
    await audit({
      actor: null,
      action: "auth.blocked",
      outcome: "denied",
      targetType: "account",
      targetLabel: username,
      summary: "Too many failed sign-in attempts.",
      address: input.address,
    });
    return {
      ok: false,
      reason: `Too many attempts. Try again in ${throttle.retryAfterMinutes} minutes.`,
      retryAfterMinutes: throttle.retryAfterMinutes,
    };
  }

  if (!username || !password) {
    await recordAttempt("password", false, input.address, username || null);
    return { ok: false, reason: VAGUE };
  }

  const row = await queryOne<CredentialRow>(
    `SELECT a.id, a.username, a.salt, a.verifier, a.locked,
            (SELECT MAX(aa.gmlevel) FROM ${schema.auth}.\`account_access\` aa
              WHERE aa.id = a.id AND (aa.RealmID = -1 OR aa.RealmID = ?)) AS gmlevel,
            (SELECT COUNT(*) FROM ${schema.auth}.\`account_banned\` ab
              WHERE ab.id = a.id AND ab.active = 1
                AND (ab.unbandate > UNIX_TIMESTAMP() OR ab.unbandate = ab.bandate)) AS banned
       FROM ${schema.auth}.\`account\` a
      WHERE a.username = ?
      LIMIT 1`,
    [env.realm.id, username],
  );

  /**
   * The verification runs even when the account does not exist, against a
   * throwaway salt and verifier. Skipping it would make a missing username
   * measurably faster to reject than a wrong password, and username
   * enumeration by stopwatch is still enumeration.
   */
  const salt = row?.salt ?? Buffer.alloc(32, 1);
  const verifier = row?.verifier ?? Buffer.alloc(32, 2);
  const passwordOk = verifyPassword(row?.username ?? username, password, salt, verifier);

  const gmLevel = row?.gmlevel ?? 0;
  const role = roleForLevel(gmLevel);
  const eligible = Boolean(row) && passwordOk && role !== null && gmLevel >= MINIMUM_PANEL_LEVEL;
  const usable = eligible && row!.locked === 0 && row!.banned === 0;

  if (!usable) {
    await recordAttempt("password", false, input.address, username);
    await audit({
      actor: null,
      action: "auth.login_failed",
      outcome: "denied",
      targetType: "account",
      targetId: row?.id ?? null,
      targetLabel: username,
      // The log may say what the sign-in page must not.
      summary: !row
        ? "No such account."
        : !passwordOk
          ? "Incorrect password."
          : role === null || gmLevel < MINIMUM_PANEL_LEVEL
            ? `Account is not staff (gmlevel ${gmLevel}).`
            : row.banned > 0
              ? "Account is banned."
              : "Account is locked.",
      address: input.address,
    });
    return { ok: false, reason: VAGUE };
  }

  const account = row!;
  const actor: Actor = { accountId: account.id, username: account.username, gmLevel, role: role! };

  /**
   * TOTP is mandatory, so an account without one is not let in - it is sent to
   * enrol. The difference matters: "no second factor yet" must not become a
   * quiet way to have no second factor at all.
   */
  const mfa = await mfaState(account.id);
  if (mfa.status === "locked") {
    await recordAttempt("password", false, input.address, username);
    return { ok: false, reason: "This account is temporarily locked. Try again later." };
  }
  const stage: SessionStage = mfa.status === "enrolled" ? "pending_totp" : "pending_enrolment";

  const created = await createSession({
    accountId: account.id,
    username: account.username,
    verifierFingerprint: accountFingerprint(account.verifier),
    stage,
    address: input.address,
    userAgent: input.userAgent,
  });
  await writeSessionCookie(created.cookie, created.expiresAt);

  await recordAttempt("password", true, input.address, username);
  await audit({
    actor,
    action: "auth.login",
    outcome: "ok",
    targetType: "account",
    targetId: account.id,
    targetLabel: account.username,
    summary: `Password accepted; awaiting ${stage === "pending_enrolment" ? "authenticator enrolment" : "authenticator code"}.`,
    address: input.address,
    sessionId: created.id,
  });

  return { ok: true, stage, actor };
}

/** Old attempt rows are only interesting while they are inside the window. */
export async function pruneLoginAttempts(keepHours = 48): Promise<number> {
  const result = await execute(
    `DELETE FROM ${schema.admin}.\`admin_login_attempt\` WHERE at < (NOW() - INTERVAL ? HOUR)`,
    [Math.max(1, Math.trunc(keepHours))],
  );
  return result.affectedRows;
}
