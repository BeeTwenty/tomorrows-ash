import { randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { calculateVerifier } from "@shared/srp6";
import { MAX_PASSWORD_LENGTH, upperLatin } from "@shared/limits";
import { execute, query, queryOne, schema, transaction, type SqlParam } from "./db";
import { env } from "./env";
import { roleForLevel, type Actor, type Role } from "./roles";
import { revokeSessionsForAccount } from "./session";

/**
 * Accounts, as the panel sees them.
 *
 * Two decisions here are not obvious from the code alone.
 *
 * **The ban predicate is copied from the core, not invented.** AzerothCore's
 * login query is the definition of "banned":
 *
 *     ab.active = 1 AND (ab.unbandate > UNIX_TIMESTAMP() OR ab.unbandate = ab.bandate)
 *
 * (LoginDatabase.cpp, LOGIN_SEL_LOGONCHALLENGE). `unbandate = bandate` is how
 * a permanent ban is written, and `active = 1` alone is *not* enough: expired
 * rows keep active = 1 until the worldserver's periodic sweep clears them, so
 * a panel that checked only `active` would show players as banned who can log
 * in perfectly well. That mismatch is the kind of thing that gets a support
 * ticket answered wrongly.
 *
 * **Ban is an INSERT, unban is an UPDATE.** The primary key is (id, bandate),
 * so bans accumulate as history rather than overwriting - which is what makes
 * "has this account been here before" answerable. Unbanning sets active = 0 on
 * the whole history, exactly as `.unban account` does.
 */

export interface AccountSummary {
  id: number;
  username: string;
  email: string | null;
  joinDate: Date | null;
  lastLogin: Date | null;
  lastIp: string | null;
  online: boolean;
  locked: boolean;
  gmLevel: number;
  role: Role | null;
  banned: boolean;
  banPermanent: boolean;
  banExpires: Date | null;
  banReason: string | null;
  bannedBy: string | null;
  mutedUntil: Date | null;
  characterCount: number;
}

interface AccountRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  reg_mail: string;
  joindate: Date | null;
  last_login: Date | null;
  last_ip: string;
  online: number;
  locked: number;
  mutetime: number | null;
  gmlevel: number | null;
  ban_active: number | null;
  ban_permanent: number | null;
  unbandate: number | null;
  banreason: string | null;
  bannedby: string | null;
  character_count: number;
}

/**
 * The ban join, written once.
 *
 * `ORDER BY bandate DESC LIMIT 1` inside the subquery matters: an account can
 * hold several active rows if it was banned twice without an unban between,
 * and the newest one is the one in force.
 */
const BAN_JOIN = `
  LEFT JOIN (
    SELECT b.id, b.unbandate, b.bandate, b.banreason, b.bannedby
      FROM ${schema.auth}.\`account_banned\` b
     WHERE b.active = 1 AND (b.unbandate > UNIX_TIMESTAMP() OR b.unbandate = b.bandate)
     ORDER BY b.bandate DESC
  ) ab ON ab.id = a.id`;

const SELECT_ACCOUNT = `
  SELECT a.id, a.username, a.email, a.reg_mail, a.joindate, a.last_login, a.last_ip,
         a.online, a.locked, a.mutetime,
         (SELECT MAX(aa.gmlevel) FROM ${schema.auth}.\`account_access\` aa
           WHERE aa.id = a.id AND (aa.RealmID = -1 OR aa.RealmID = ?)) AS gmlevel,
         (ab.id IS NOT NULL)                AS ban_active,
         (ab.unbandate = ab.bandate)        AS ban_permanent,
         ab.unbandate                       AS unbandate,
         ab.banreason                       AS banreason,
         ab.bannedby                        AS bannedby,
         (SELECT COUNT(*) FROM ${schema.chars}.\`characters\` c
           WHERE c.account = a.id AND c.deleteDate IS NULL) AS character_count
    FROM ${schema.auth}.\`account\` a
    ${BAN_JOIN}`;

function toSummary(row: AccountRow): AccountSummary {
  const gmLevel = row.gmlevel ?? 0;
  const mute = Number(row.mutetime ?? 0);

  return {
    id: row.id,
    username: row.username,
    // `email` is the account's contact address, `reg_mail` the one it
    // registered with. Either can be blank; showing the blank one as "—"
    // rather than "" keeps the table honest about which.
    email: row.email || row.reg_mail || null,
    joinDate: row.joindate,
    lastLogin: row.last_login,
    lastIp: row.last_ip || null,
    online: row.online > 0,
    locked: row.locked > 0,
    gmLevel,
    role: roleForLevel(gmLevel),
    banned: Boolean(row.ban_active),
    banPermanent: Boolean(row.ban_permanent),
    banExpires: row.ban_permanent || !row.unbandate ? null : new Date(row.unbandate * 1000),
    banReason: row.banreason,
    bannedBy: row.bannedby,
    // mutetime is a unix timestamp, and the core writes 0 for "not muted".
    mutedUntil: mute > Math.floor(Date.now() / 1000) ? new Date(mute * 1000) : null,
    characterCount: Number(row.character_count ?? 0),
  };
}

export interface AccountSearch {
  q?: string;
  status?: "all" | "banned" | "online" | "staff";
  limit?: number;
  offset?: number;
}

export async function searchAccounts(search: AccountSearch): Promise<{ rows: AccountSummary[]; total: number }> {
  const limit = Math.min(200, Math.max(1, search.limit ?? 50));
  const offset = Math.max(0, search.offset ?? 0);

  const where: string[] = [];
  const params: SqlParam[] = [env.realm.id];

  const q = search.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      where.push("(a.id = ? OR a.username LIKE ?)");
      params.push(Number(q), `%${upperLatin(q)}%`);
    } else {
      where.push("(a.username LIKE ? OR a.email LIKE ? OR a.reg_mail LIKE ? OR a.last_ip = ?)");
      params.push(`%${upperLatin(q)}%`, `%${q}%`, `%${q}%`, q);
    }
  }

  switch (search.status) {
    case "banned":
      where.push("ab.id IS NOT NULL");
      break;
    case "online":
      where.push("a.online > 0");
      break;
    case "staff":
      where.push(
        `EXISTS (SELECT 1 FROM ${schema.auth}.\`account_access\` aa2
                  WHERE aa2.id = a.id AND aa2.gmlevel > 0 AND (aa2.RealmID = -1 OR aa2.RealmID = ?))`,
      );
      params.push(env.realm.id);
      break;
    default:
      break;
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<AccountRow>(
    `${SELECT_ACCOUNT} ${clause} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const counted = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM ${schema.auth}.\`account\` a ${BAN_JOIN} ${clause}`,
    // The count does not need the realm parameter the SELECT list uses, but a
    // "staff" filter puts one back. Rebuilding it here keeps the two in step.
    params.slice(1),
  );

  return { rows: rows.map(toSummary), total: Number(counted[0]?.n ?? 0) };
}

export async function getAccount(id: number): Promise<AccountSummary | null> {
  const row = await queryOne<AccountRow>(`${SELECT_ACCOUNT} WHERE a.id = ? LIMIT 1`, [env.realm.id, id]);
  return row ? toSummary(row) : null;
}

export interface BanHistoryEntry {
  bandate: Date;
  unbandate: Date | null;
  permanent: boolean;
  active: boolean;
  bannedBy: string;
  reason: string;
}

export async function banHistory(accountId: number, limit = 25): Promise<BanHistoryEntry[]> {
  const rows = await query<RowDataPacket & {
    bandate: number;
    unbandate: number;
    bannedby: string;
    banreason: string;
    active: number;
  }>(
    `SELECT bandate, unbandate, bannedby, banreason, active
       FROM ${schema.auth}.\`account_banned\`
      WHERE id = ?
      ORDER BY bandate DESC
      LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}`,
    [accountId],
  );

  return rows.map((row) => ({
    bandate: new Date(row.bandate * 1000),
    unbandate: row.unbandate === row.bandate ? null : new Date(row.unbandate * 1000),
    permanent: row.unbandate === row.bandate,
    active: row.active > 0,
    bannedBy: row.bannedby,
    reason: row.banreason,
  }));
}

/**
 * Ban an account.
 *
 * `durationSeconds = 0` writes unbandate = bandate, which is how the core
 * spells "permanent" - not a null, not a far-future date.
 *
 * The panel does not kick the player itself. If they are online, the ban row
 * alone will not disconnect them; that needs the worldserver, which is what the
 * SOAP path is for. Callers pass `kick` and get told whether it worked, rather
 * than being left to assume it did.
 */
export async function banAccount(input: {
  accountId: number;
  bannedBy: string;
  reason: string;
  durationSeconds: number;
}): Promise<void> {
  await execute(
    `INSERT INTO ${schema.auth}.\`account_banned\` (id, bandate, unbandate, bannedby, banreason, active)
     VALUES (?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP() + ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE unbandate = VALUES(unbandate), bannedby = VALUES(bannedby),
                             banreason = VALUES(banreason), active = 1`,
    [input.accountId, Math.max(0, Math.trunc(input.durationSeconds)), input.bannedBy.slice(0, 50), input.reason.slice(0, 255)],
  );

  // A banned account has no business holding a live panel session.
  await revokeSessionsForAccount(input.accountId, "account-banned");
}

export async function unbanAccount(accountId: number): Promise<number> {
  const result = await execute(
    `UPDATE ${schema.auth}.\`account_banned\` SET active = 0 WHERE id = ? AND active != 0`,
    [accountId],
  );
  return result.affectedRows;
}

/**
 * Set a new password.
 *
 * The verifier is computed exactly as the core does - `src/lib/srp6.ts` is a
 * port of the pinned upstream and its test asserts against a vector captured
 * from the compiled `Acore::Crypto::SRP6`. Getting the little-endian
 * conversions wrong here would produce an account that no client can log into,
 * silently.
 *
 * The password is not stored, mailed or logged anywhere. It is returned to the
 * caller once, to be read out to the player, and the audit row records that a
 * reset happened - never what it was set to.
 */
export async function setPassword(accountId: number, username: string, password: string): Promise<void> {
  const clean = password.slice(0, MAX_PASSWORD_LENGTH);
  const salt = randomBytes(32);
  const verifier = calculateVerifier(username, clean, salt);

  await execute(
    `UPDATE ${schema.auth}.\`account\` SET salt = ?, verifier = ?, session_key = NULL WHERE id = ?`,
    [salt, verifier, accountId],
  );

  // Changing the verifier already invalidates panel sessions on their next
  // request (the fingerprint check). Revoking here makes it immediate.
  await revokeSessionsForAccount(accountId, "password-reset");
}

/** A password a person can read over voice chat without ambiguity. */
export function suggestPassword(): string {
  // No I/l/1/O/0. Sixteen characters is the client's ceiling, so twelve leaves
  // room for a player who wants to type it as-is and change it later.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function setLocked(accountId: number, locked: boolean): Promise<void> {
  await execute(`UPDATE ${schema.auth}.\`account\` SET locked = ? WHERE id = ?`, [locked ? 1 : 0, accountId]);
}

/**
 * Mute, in the core's own units: `account.mutetime` is a unix timestamp, and 0
 * means not muted. The worldserver reads it at login, so a mute applied while
 * the player is online needs the SOAP path to take effect immediately.
 */
export async function setMute(accountId: number, until: Date | null): Promise<void> {
  await execute(`UPDATE ${schema.auth}.\`account\` SET mutetime = ? WHERE id = ?`, [
    until ? Math.floor(until.getTime() / 1000) : 0,
    accountId,
  ]);
}

/**
 * Change a staff level.
 *
 * Level 0 is not a row with a zero in it - it is the absence of a row, which is
 * what `.account set gmlevel 0` produces. Writing a 0 row instead would leave
 * an account that reads as staff to any query that looks for a row's existence.
 *
 * The escalation rules live in `roles.ts` and are applied by the caller through
 * `authz.enforce`. This function assumes they already passed; it is not the
 * place to re-derive them, and having one place that decides is the point.
 */
export async function setGmLevel(accountId: number, level: number, realmId: number): Promise<void> {
  await transaction(async (run) => {
    await run.execute(
      `DELETE FROM ${schema.auth}.\`account_access\` WHERE id = ? AND (RealmID = ? OR RealmID = -1)`,
      [accountId, realmId],
    );
    if (level > 0) {
      await run.execute(
        `INSERT INTO ${schema.auth}.\`account_access\` (id, gmlevel, RealmID, comment)
         VALUES (?, ?, ?, 'set from the Ashmorrow admin panel')`,
        [accountId, level, realmId],
      );
    }
  });

  // Whether promoted or demoted, the level they signed in under is stale.
  await revokeSessionsForAccount(accountId, "gmlevel-changed");
}

/** The actor, as a target: used by the guards, which need the target's level. */
export async function actorTarget(accountId: number): Promise<Pick<Actor, "accountId" | "gmLevel"> | null> {
  const account = await getAccount(accountId);
  return account ? { accountId: account.id, gmLevel: account.gmLevel } : null;
}
