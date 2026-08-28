import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne, schema, tableExists } from "./db";
import { env, isDemo } from "./env";
import { calculateVerifier, makeRegistrationData, verifyPassword } from "./srp6";
import { executeCommand } from "./soap";
import { audit } from "./audit";
import { ipv4OrEmpty } from "./request";

/**
 * Account services against the AzerothCore auth database.
 *
 * Two write paths, chosen with ACCOUNT_WRITE_MODE:
 *
 *   sql  (default) - we compute SRP6 ourselves and INSERT into `account`.
 *                    Registration keeps working while the worldserver is down,
 *                    which is exactly when new players tend to arrive.
 *   soap           - the worldserver's own `account create` does it, so the
 *                    core's validation is the only validation. Costs an open
 *                    SOAP port and a GM account in this service's environment.
 *
 * Everything the *site* owns - reset tokens, rate limits, the audit log - lives
 * in its own schema. No column is ever added to an AzerothCore table, which is
 * the same rule the game module follows (docs/ARCHITECTURE.md §4).
 */

export type AccountField = "username" | "password" | "email" | "token" | "form";

export type AccountResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string; field: AccountField };

const fail = (error: string, field: AccountField = "form"): AccountResult<never> => ({
  ok: false,
  error,
  field,
});

const DEMO_NOTICE =
  "This site is running in demo mode with no realm database attached, so account services are switched off.";

interface AccountRow extends RowDataPacket {
  id: number;
  username: string;
  salt: Buffer;
  verifier: Buffer;
  email: string;
  reg_mail: string;
  joindate: Date;
  last_login: Date | null;
  online: number;
  locked: number;
}

export interface AccountInfo {
  id: number;
  username: string;
  email: string;
  joinDate: Date;
  lastLogin: Date | null;
  online: boolean;
  locked: boolean;
}

function toInfo(row: AccountRow): AccountInfo {
  return {
    id: row.id,
    username: row.username,
    email: row.email || row.reg_mail || "",
    joinDate: row.joindate,
    lastLogin: row.last_login,
    online: row.online === 1,
    locked: row.locked === 1,
  };
}

/**
 * A short, non-reversible tag for the account's current credentials.
 *
 * It goes into the session cookie and is re-checked on every authenticated
 * request, so changing a password silently invalidates every existing session.
 */
export function accountFingerprint(verifier: Buffer): string {
  return createHash("sha256").update(verifier).digest("hex").slice(0, 16);
}

const ACCOUNT_COLUMNS = "id, username, salt, verifier, email, reg_mail, joindate, last_login, online, locked";

async function findByUsername(username: string): Promise<AccountRow | null> {
  return queryOne<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${schema.auth}.\`account\` WHERE username = ? LIMIT 1`,
    [username],
  );
}

export async function getAccountById(id: number): Promise<AccountInfo | null> {
  if (isDemo) return null;
  const row = await queryOne<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${schema.auth}.\`account\` WHERE id = ? LIMIT 1`,
    [id],
  );
  return row ? toInfo(row) : null;
}

/**
 * Resolve a session cookie to a live account.
 *
 * Returns null if the account vanished or its credentials changed since the
 * cookie was issued - the caller then treats the visitor as signed out.
 */
export async function resolveSession(accountId: number, fingerprint: string): Promise<AccountInfo | null> {
  if (isDemo) return null;
  const row = await queryOne<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${schema.auth}.\`account\` WHERE id = ? LIMIT 1`,
    [accountId],
  );
  if (!row) return null;
  if (accountFingerprint(row.verifier) !== fingerprint) return null;
  return toInfo(row);
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

export interface RegisterInput {
  username: string;
  password: string;
  email: string;
  address: string;
}

export interface RegisteredAccount {
  id: number;
  username: string;
}

export async function registerAccount(input: RegisterInput): Promise<AccountResult<RegisteredAccount>> {
  if (isDemo) return fail(DEMO_NOTICE);
  if (!env.accounts.registrationEnabled) {
    return fail("Registration is closed on this realm right now.");
  }

  const existing = await findByUsername(input.username);
  if (existing) return fail("That account name is taken.", "username");

  if (env.accounts.uniqueEmail && input.email) {
    const emailRow = await queryOne<RowDataPacket & { id: number }>(
      `SELECT id FROM ${schema.auth}.\`account\` WHERE email = ? OR reg_mail = ? LIMIT 1`,
      [input.email, input.email],
    );
    if (emailRow) return fail("An account already uses that email address.", "email");
  }

  try {
    if (env.accounts.writeMode === "soap") {
      await executeCommand(`account create ${input.username} ${input.password}`);
      const created = await findByUsername(input.username);
      if (!created) {
        return fail("The realm accepted the account but it is not in the database yet. Try logging in shortly.");
      }
      // `account create` does not take an email, and password reset needs one.
      await execute(
        `UPDATE ${schema.auth}.\`account\` SET email = ?, reg_mail = ? WHERE id = ?`,
        [input.email, input.email, created.id],
      );
      await audit("register", { accountId: created.id, username: created.username, address: input.address });
      return { ok: true, value: { id: created.id, username: created.username } };
    }

    const { salt, verifier } = makeRegistrationData(input.username, input.password);
    const result = await execute(
      // Column order mirrors LOGIN_INS_ACCOUNT at the pinned upstream commit.
      `INSERT INTO ${schema.auth}.\`account\`
         (username, salt, verifier, expansion, reg_mail, email, joindate, last_ip)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        input.username,
        salt,
        verifier,
        env.accounts.expansion,
        input.email,
        input.email,
        ipv4OrEmpty(input.address) || "127.0.0.1",
      ],
    );

    const accountId = result.insertId;

    // The core does this after every account creation so the realm's character
    // counter has a row to increment.
    await execute(
      `INSERT IGNORE INTO ${schema.auth}.\`realmcharacters\` (realmid, acctid, numchars)
       SELECT id, ?, 0 FROM ${schema.auth}.\`realmlist\``,
      [accountId],
    );

    await audit("register", { accountId, username: input.username, address: input.address });
    return { ok: true, value: { id: accountId, username: input.username } };
  } catch (error) {
    if (isDuplicateKey(error)) return fail("That account name is taken.", "username");
    console.error("[accounts] registration failed:", error);
    return fail("The realm database refused the registration. Try again in a moment.");
  }
}

export interface AuthenticateInput {
  username: string;
  password: string;
  address: string;
}

export interface AuthenticatedAccount {
  id: number;
  username: string;
  fingerprint: string;
}

export async function authenticate(input: AuthenticateInput): Promise<AccountResult<AuthenticatedAccount>> {
  if (isDemo) return fail(DEMO_NOTICE);

  const row = await findByUsername(input.username);

  // Same message for "no such account" and "wrong password": a login form
  // should not be an account-name oracle.
  const rejected = fail("That account name and password do not match.", "password");

  if (!row) {
    await audit("login_failed", { username: input.username, address: input.address, detail: "no such account" });
    return rejected;
  }

  if (!verifyPassword(row.username, input.password, row.salt, row.verifier)) {
    await audit("login_failed", { accountId: row.id, username: row.username, address: input.address });
    return rejected;
  }

  if (row.locked === 1) {
    return fail("That account is locked. Contact the realm staff.", "form");
  }

  await audit("login", { accountId: row.id, username: row.username, address: input.address });
  return {
    ok: true,
    value: { id: row.id, username: row.username, fingerprint: accountFingerprint(row.verifier) },
  };
}

/** Write new credentials for an account. Mirrors `AccountMgr::ChangePassword`. */
async function writeCredentials(accountId: number, username: string, password: string): Promise<string> {
  const { salt, verifier } = makeRegistrationData(username, password);
  await execute(
    `UPDATE ${schema.auth}.\`account\` SET salt = ?, verifier = ?, session_key = NULL WHERE id = ?`,
    [salt, verifier, accountId],
  );
  return accountFingerprint(verifier);
}

export interface ChangePasswordInput {
  accountId: number;
  currentPassword: string;
  newPassword: string;
  address: string;
}

export async function changePassword(input: ChangePasswordInput): Promise<AccountResult<{ fingerprint: string }>> {
  if (isDemo) return fail(DEMO_NOTICE);

  const row = await queryOne<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${schema.auth}.\`account\` WHERE id = ? LIMIT 1`,
    [input.accountId],
  );
  if (!row) return fail("That account no longer exists.");

  if (!verifyPassword(row.username, input.currentPassword, row.salt, row.verifier)) {
    await audit("login_failed", {
      accountId: row.id,
      username: row.username,
      address: input.address,
      detail: "password change",
    });
    return fail("Your current password is not correct.", "password");
  }

  const fingerprint = await writeCredentials(row.id, row.username, input.newPassword);
  await invalidateResetTokens(row.id);
  await audit("password_change", { accountId: row.id, username: row.username, address: input.address });
  return { ok: true, value: { fingerprint } };
}

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

interface ResetRow extends RowDataPacket {
  id: number;
  account_id: number;
  expires_at: Date;
  used_at: Date | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function resetTableReady(): Promise<boolean> {
  const ready = await tableExists(env.db.web, "web_password_reset");
  if (!ready) {
    console.warn(
      "[accounts] web_password_reset is missing - apply web/sql/web-schema.sql. Password reset is unavailable.",
    );
  }
  return ready;
}

async function invalidateResetTokens(accountId: number): Promise<void> {
  if (!(await resetTableReady())) return;
  await execute(
    `UPDATE ${schema.web}.\`web_password_reset\` SET used_at = NOW()
      WHERE account_id = ? AND used_at IS NULL`,
    [accountId],
  );
}

export interface ResetRequestOutcome {
  /** True when a token was created and handed to the mailer. */
  issued: boolean;
  /** The single-use link. Only ever logged or emailed, never rendered. */
  link?: string;
  account?: { id: number; username: string; email: string };
}

/**
 * Start a password reset.
 *
 * The caller always tells the visitor the same thing regardless of outcome -
 * this function's return value is for the mailer and the log, never for the
 * page. Anything else turns the form into an email-address oracle.
 */
export async function createPasswordReset(email: string, address: string): Promise<ResetRequestOutcome> {
  if (isDemo || !(await resetTableReady())) return { issued: false };

  const row = await queryOne<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${schema.auth}.\`account\`
      WHERE email = ? OR reg_mail = ? LIMIT 1`,
    [email, email],
  );
  if (!row) return { issued: false };

  const token = randomBytes(32).toString("base64url");
  await execute(
    `INSERT INTO ${schema.web}.\`web_password_reset\` (account_id, token_hash, expires_at, address)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
    [row.id, hashToken(token), env.accounts.resetTokenMinutes, address.slice(0, 45)],
  );

  await audit("password_reset_request", { accountId: row.id, username: row.username, address });

  return {
    issued: true,
    link: `${env.siteUrl}/reset?token=${token}`,
    account: { id: row.id, username: row.username, email: row.email || row.reg_mail },
  };
}

export async function consumePasswordReset(
  token: string,
  newPassword: string,
  address: string,
): Promise<AccountResult<{ username: string }>> {
  if (isDemo) return fail(DEMO_NOTICE);
  if (!(await resetTableReady())) {
    return fail("Password reset is not set up on this site yet. Contact the realm staff.");
  }

  const rows = await query<ResetRow>(
    `SELECT id, account_id, expires_at, used_at
       FROM ${schema.web}.\`web_password_reset\`
      WHERE token_hash = ? LIMIT 1`,
    [hashToken(token)],
  );

  const record = rows[0];
  const invalid = fail("That reset link is invalid or has already been used.", "token");

  if (!record) {
    await audit("password_reset_failed", { address, detail: "unknown token" });
    return invalid;
  }
  if (record.used_at !== null) {
    await audit("password_reset_failed", { accountId: record.account_id, address, detail: "token reused" });
    return invalid;
  }
  if (record.expires_at.getTime() <= Date.now()) {
    await audit("password_reset_failed", { accountId: record.account_id, address, detail: "token expired" });
    return fail("That reset link has expired. Request a new one.", "token");
  }

  const account = await queryOne<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${schema.auth}.\`account\` WHERE id = ? LIMIT 1`,
    [record.account_id],
  );
  if (!account) return invalid;

  await writeCredentials(account.id, account.username, newPassword);

  // Burn this token and every other outstanding one for the account.
  await execute(
    `UPDATE ${schema.web}.\`web_password_reset\` SET used_at = NOW()
      WHERE account_id = ? AND used_at IS NULL`,
    [account.id],
  );

  await audit("password_reset", { accountId: account.id, username: account.username, address });
  return { ok: true, value: { username: account.username } };
}

/**
 * Confirm that this implementation agrees with the core's.
 *
 * Given an account the *server* created, recompute the verifier from the
 * stored salt and the known password. If they match, the SRP6 port is correct
 * for this realm - the only check that truly proves it. Used by
 * `ta.py web verify-srp6`.
 */
export async function verifySrp6Against(username: string, password: string): Promise<boolean> {
  const row = await findByUsername(username);
  if (!row) throw new Error(`No account named ${username} in ${env.db.auth}.`);
  const candidate = calculateVerifier(row.username, password, row.salt);
  return candidate.length === row.verifier.length && timingSafeEqual(candidate, row.verifier);
}
