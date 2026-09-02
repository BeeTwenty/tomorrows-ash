import { createHash, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne, schema, transaction } from "./db";
import { seal, unseal } from "./secretbox";
import {
  enrolmentUri,
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  verifyCode,
} from "./totp";

/**
 * The second factor, and the parts of it that live in the database.
 *
 * `src/lib/totp.ts` is the pure algorithm and is tested against RFC 6238's own
 * published vectors. This file is everything the algorithm cannot know: whether
 * a code has already been spent, how many times this account has guessed
 * wrong, and whether the enrolment was ever confirmed.
 *
 * Three rules that are easy to leave out and expensive to leave out:
 *
 *   1. **A code is spent when it is used.** The window is ±1 step to tolerate
 *      clock drift, which means a code lives up to 90 seconds. Recording the
 *      step and refusing anything at or below it makes it live exactly once.
 *   2. **Enrolment is not complete until a code is confirmed.** Storing the
 *      secret at the moment it is shown would let a mistyped setup lock the
 *      account out of a panel it can no longer prove itself to.
 *   3. **Recovery codes are single-use and hashed.** They are passwords with a
 *      nicer format, so they are stored the way passwords are.
 */

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

function sealedText(value: Buffer | string): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

interface TotpRow extends RowDataPacket {
  account_id: number;
  /**
   * VARBINARY, so mysql2 hands this back as a Buffer rather than a string.
   * The sealed value is ASCII base64url, but the column is binary on purpose -
   * a sealed secret has no business being subject to a collation. Every read
   * goes through `sealedText` rather than being used directly.
   */
  secret: Buffer | string;
  confirmed_at: Date | null;
  last_step: number;
  failures: number;
  locked_until: Date | null;
}

export type MfaState =
  | { status: "none" }
  | { status: "pending" }
  | { status: "enrolled" }
  | { status: "locked"; until: Date };

export async function mfaState(accountId: number): Promise<MfaState> {
  const row = await queryOne<TotpRow>(
    `SELECT account_id, confirmed_at, locked_until FROM ${schema.admin}.\`admin_totp\` WHERE account_id = ? LIMIT 1`,
    [accountId],
  );
  if (!row) return { status: "none" };
  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    return { status: "locked", until: row.locked_until };
  }
  return row.confirmed_at ? { status: "enrolled" } : { status: "pending" };
}

export interface Enrolment {
  secret: string;
  uri: string;
}

/**
 * Begin enrolment, or resume one already in progress.
 *
 * An unconfirmed secret is **reused**, not replaced, and that is load-bearing.
 * Issuing a fresh secret on every page render looks harmless until you notice
 * how many things render the page: a second tab, a refresh, a guard redirecting
 * an unrelated request back here. Each one would silently invalidate the secret
 * the person is part-way through typing into their authenticator, and the only
 * symptom would be "that code is not right" for a code that was right.
 *
 * A *confirmed* row is never touched here - clearing a working second factor is
 * an owner action with its own permission, not a side effect of visiting a page.
 */
export async function beginEnrolment(accountId: number, username: string): Promise<Enrolment | null> {
  const existing = await queryOne<TotpRow>(
    `SELECT account_id, secret, confirmed_at FROM ${schema.admin}.\`admin_totp\` WHERE account_id = ? LIMIT 1`,
    [accountId],
  );
  if (existing?.confirmed_at) return null;

  if (existing) {
    const resumed = unseal(sealedText(existing.secret));
    if (resumed) return { secret: resumed, uri: enrolmentUri(resumed, username) };
    // Unreadable - a rotated ADMIN_TOTP_KEY, or a corrupted row. Nothing can be
    // resumed from it, so fall through and issue a new one.
  }

  const secret = generateSecret();
  await execute(
    `INSERT INTO ${schema.admin}.\`admin_totp\` (account_id, username, secret, last_step, failures)
     VALUES (?, ?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE secret = VALUES(secret), username = VALUES(username),
                             last_step = 0, failures = 0, locked_until = NULL, created_at = NOW()`,
    [accountId, username.slice(0, 32), seal(secret)],
  );

  return { secret, uri: enrolmentUri(secret, username) };
}

/**
 * Throw away an unconfirmed enrolment so the next page render issues a new
 * secret. The deliberate way to start over, now that a page render is not.
 */
export async function restartEnrolment(accountId: number): Promise<void> {
  await execute(
    `DELETE FROM ${schema.admin}.\`admin_totp\` WHERE account_id = ? AND confirmed_at IS NULL`,
    [accountId],
  );
}

export type MfaResult =
  | { ok: true; recoveryCodes?: string[] }
  | { ok: false; reason: string; lockedUntil?: Date };

/**
 * Confirm an enrolment and issue the recovery codes.
 *
 * The codes are returned once, in the clear, and stored only as hashes. There
 * is no "show them again" - that is the property that makes them worth having.
 */
export async function confirmEnrolment(accountId: number, code: string): Promise<MfaResult> {
  const row = await queryOne<TotpRow>(
    `SELECT account_id, secret, confirmed_at, last_step, failures, locked_until
       FROM ${schema.admin}.\`admin_totp\` WHERE account_id = ? LIMIT 1`,
    [accountId],
  );
  if (!row) return { ok: false, reason: "There is no enrolment in progress." };
  if (row.confirmed_at) return { ok: false, reason: "This account already has an authenticator." };

  const secret = unseal(sealedText(row.secret));
  if (!secret) return { ok: false, reason: "The stored secret could not be read. Start enrolment again." };

  const verdict = verifyCode(secret, code, { lastUsedStep: null });
  if (!verdict.ok || verdict.step === null) {
    return { ok: false, reason: "That code is not right. Check your device's clock and try the next one." };
  }

  const codes = generateRecoveryCodes();

  await transaction(async (run) => {
    await run.execute(
      `UPDATE ${schema.admin}.\`admin_totp\`
          SET confirmed_at = NOW(), last_step = ?, failures = 0, locked_until = NULL
        WHERE account_id = ?`,
      [verdict.step, accountId],
    );
    await run.execute(`DELETE FROM ${schema.admin}.\`admin_recovery_code\` WHERE account_id = ?`, [accountId]);
    for (const recovery of codes) {
      await run.execute(
        `INSERT INTO ${schema.admin}.\`admin_recovery_code\` (account_id, code_hash) VALUES (?, ?)`,
        [accountId, hashRecovery(recovery)],
      );
    }
  });

  return { ok: true, recoveryCodes: codes };
}

/** Check a code at sign-in. Spends the step on success, counts the failure otherwise. */
export async function checkCode(accountId: number, code: string): Promise<MfaResult> {
  const row = await queryOne<TotpRow>(
    `SELECT account_id, secret, confirmed_at, last_step, failures, locked_until
       FROM ${schema.admin}.\`admin_totp\` WHERE account_id = ? LIMIT 1`,
    [accountId],
  );
  if (!row || !row.confirmed_at) return { ok: false, reason: "This account has no authenticator enrolled." };

  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    return { ok: false, reason: "Too many incorrect codes. Try again later.", lockedUntil: row.locked_until };
  }

  const secret = unseal(sealedText(row.secret));
  if (!secret) return { ok: false, reason: "The stored secret could not be read. Ask an owner to reset it." };

  const verdict = verifyCode(secret, code, { lastUsedStep: row.last_step });

  if (!verdict.ok) {
    const failures = row.failures + 1;
    const lock = failures >= MAX_FAILURES;
    await execute(
      `UPDATE ${schema.admin}.\`admin_totp\`
          SET failures = ?, locked_until = ${lock ? `(NOW() + INTERVAL ${LOCKOUT_MINUTES} MINUTE)` : "NULL"}
        WHERE account_id = ?`,
      [lock ? 0 : failures, accountId],
    );
    return {
      ok: false,
      reason: lock
        ? `Too many incorrect codes. This account is locked for ${LOCKOUT_MINUTES} minutes.`
        : "That code is not right.",
    };
  }

  /**
   * Spend the step. The WHERE clause is the race guard: two requests carrying
   * the same code both pass verifyCode, and exactly one of them updates a row.
   */
  const spent = await execute(
    `UPDATE ${schema.admin}.\`admin_totp\`
        SET last_step = ?, failures = 0, locked_until = NULL
      WHERE account_id = ? AND last_step < ?`,
    [verdict.step, accountId, verdict.step],
  );
  if (spent.affectedRows === 0) return { ok: false, reason: "That code has already been used." };

  return { ok: true };
}

function hashRecovery(code: string): string {
  return createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");
}

/**
 * Spend a recovery code.
 *
 * Looked up by hash and marked used in one statement, so a code cannot be
 * redeemed twice by two requests arriving together. The lookup is by unique
 * index rather than a scan-and-compare loop, which also means the response
 * time does not vary with how many codes the account has left.
 */
export async function redeemRecoveryCode(
  accountId: number,
  code: string,
  address: string | null,
): Promise<MfaResult> {
  const cleaned = normaliseRecoveryCode(code);
  if (cleaned.length < 8) return { ok: false, reason: "That is not a recovery code." };

  const result = await execute(
    `UPDATE ${schema.admin}.\`admin_recovery_code\`
        SET used_at = NOW(), used_from = ?
      WHERE account_id = ? AND code_hash = ? AND used_at IS NULL`,
    [address?.slice(0, 45) ?? null, accountId, hashRecovery(cleaned)],
  );

  if (result.affectedRows === 0) return { ok: false, reason: "That recovery code is not valid or has been used." };

  // A recovery sign-in clears any code lockout: the person proved themselves.
  await execute(
    `UPDATE ${schema.admin}.\`admin_totp\` SET failures = 0, locked_until = NULL WHERE account_id = ?`,
    [accountId],
  );
  return { ok: true };
}

export async function recoveryCodesRemaining(accountId: number): Promise<number> {
  const rows = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM ${schema.admin}.\`admin_recovery_code\` WHERE account_id = ? AND used_at IS NULL`,
    [accountId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Remove an enrolment entirely, so the account must set up a new authenticator.
 *
 * The only way back in for a lost device with no recovery codes left. It is an
 * owner-only action (`admin.mfa.reset`) precisely because it turns the second
 * factor off for one login.
 */
export async function resetEnrolment(accountId: number): Promise<void> {
  await transaction(async (run) => {
    await run.execute(`DELETE FROM ${schema.admin}.\`admin_totp\` WHERE account_id = ?`, [accountId]);
    await run.execute(`DELETE FROM ${schema.admin}.\`admin_recovery_code\` WHERE account_id = ?`, [accountId]);
  });
}

/** Exposed for the tests; identical comparison semantics to the redeem path. */
export function recoveryMatches(candidate: string, storedHash: string): boolean {
  const a = Buffer.from(hashRecovery(candidate));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
