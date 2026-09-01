import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne, schema } from "./db";
import { env } from "./env";
import { textArg, trySoap, type SoapAttempt } from "./soap";

/**
 * Realm configuration the panel can actually change.
 *
 * Most of a worldserver's behaviour lives in `worldserver.conf`, which this
 * panel deliberately does not touch: editing a file the server reads once at
 * startup, from a process that cannot restart it, produces settings that are
 * true on disk and false in the world. What is here are the settings that live
 * in the database, where a change is real.
 *
 * Three of them, all verified against the pinned upstream rather than assumed:
 *
 *   **MOTD** - `acore_auth.motd (realmid, text)`. Written by
 *   `.server set motd` (cs_server.cpp:527, LOGIN_REP_MOTD). Writing the row
 *   makes it survive a restart; the console command makes it live now. The
 *   panel does both when it can, and says which half it managed.
 *
 *   **Maintenance** - `realmlist.allowedSecurityLevel`. The authserver marks a
 *   realm locked when it exceeds the account's own level
 *   (AuthSession.cpp:782), so setting it to 2 leaves the realm visible and
 *   admits only staff. That is a better maintenance mode than
 *   REALM_FLAG_OFFLINE, which hides the realm and tells players nothing.
 *
 *   **Population cap** is *not* here. It is `PlayerLimit` in worldserver.conf
 *   with no database representation, so the panel would be lying if it offered
 *   a field. The realm page says so rather than leaving a gap.
 */

export interface RealmRow {
  id: number;
  name: string;
  address: string;
  port: number;
  icon: number;
  flag: number;
  allowedSecurityLevel: number;
  population: number;
  gamebuild: number;
}

export async function getRealm(): Promise<RealmRow | null> {
  const row = await queryOne<RowDataPacket & RealmRow>(
    `SELECT id, name, address, port, icon, flag, allowedSecurityLevel, population, gamebuild
       FROM ${schema.auth}.\`realmlist\` WHERE id = ? LIMIT 1`,
    [env.realm.id],
  );
  return row ?? null;
}

export interface RealmStatus {
  realm: RealmRow | null;
  motd: string | null;
  accountsOnline: number;
  charactersOnline: number;
  charactersTotal: number;
  accountsTotal: number;
  uptimeSeconds: number | null;
  startedAt: Date | null;
  revision: string | null;
  maxPlayersSeen: number | null;
}

export async function realmStatus(): Promise<RealmStatus> {
  const [realm, motdRow, counts, uptime] = await Promise.all([
    getRealm(),
    queryOne<RowDataPacket & { text: string | null }>(
      `SELECT text FROM ${schema.auth}.\`motd\` WHERE realmid = ? OR realmid = -1 ORDER BY realmid DESC LIMIT 1`,
      [env.realm.id],
    ),
    queryOne<RowDataPacket & {
      accounts_online: number;
      characters_online: number;
      characters_total: number;
      accounts_total: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM ${schema.auth}.\`account\` WHERE online > 0)                   AS accounts_online,
         (SELECT COUNT(*) FROM ${schema.chars}.\`characters\` WHERE online > 0)               AS characters_online,
         (SELECT COUNT(*) FROM ${schema.chars}.\`characters\` WHERE deleteDate IS NULL)       AS characters_total,
         (SELECT COUNT(*) FROM ${schema.auth}.\`account\`)                                    AS accounts_total`,
    ),
    queryOne<RowDataPacket & { starttime: number; uptime: number; maxplayers: number; revision: string }>(
      `SELECT starttime, uptime, maxplayers, revision
         FROM ${schema.auth}.\`uptime\` WHERE realmid = ? ORDER BY starttime DESC LIMIT 1`,
      [env.realm.id],
    ),
  ]);

  return {
    realm,
    motd: motdRow?.text ?? null,
    accountsOnline: Number(counts?.accounts_online ?? 0),
    charactersOnline: Number(counts?.characters_online ?? 0),
    charactersTotal: Number(counts?.characters_total ?? 0),
    accountsTotal: Number(counts?.accounts_total ?? 0),
    uptimeSeconds: uptime ? Number(uptime.uptime) : null,
    startedAt: uptime ? new Date(Number(uptime.starttime) * 1000) : null,
    revision: uptime?.revision ?? null,
    maxPlayersSeen: uptime ? Number(uptime.maxplayers) : null,
  };
}

export interface MotdResult {
  stored: boolean;
  live: SoapAttempt;
}

/**
 * Set the message of the day.
 *
 * The row is written first, because that is the half that survives a restart
 * and the half that cannot fail for want of a console. The console call is
 * then attempted so it takes effect without one, and its outcome is returned
 * rather than swallowed: "saved, but the running server still shows the old
 * one until it restarts" is the truth in that case and the operator should
 * read it.
 */
export async function setMotd(text: string): Promise<MotdResult> {
  const clean = textArg(text, 500);

  // INSERT ... ON DUPLICATE KEY rather than the core's REPLACE: REPLACE is a
  // delete plus an insert and would need DELETE on the table, which is a
  // privilege the panel has no other use for. The end state is identical.
  await execute(
    `INSERT INTO ${schema.auth}.\`motd\` (realmid, text) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE text = VALUES(text)`,
    [env.realm.id, clean],
  );

  // `.server set motd <realmId> <locale> <text>` at the pinned commit.
  const live = await trySoap(`server set motd ${env.realm.id} enUS ${clean}`);
  return { stored: true, live };
}

/**
 * Maintenance mode: the minimum staff level allowed to log in.
 *
 * 0 admits everyone. 2 (SEC_GAMEMASTER) is the usual maintenance setting. The
 * authserver reads this per connection, so it takes effect on the next login
 * attempt without a restart and without SOAP.
 */
export async function setMaintenance(minimumSecurityLevel: number): Promise<void> {
  if (!Number.isInteger(minimumSecurityLevel) || minimumSecurityLevel < 0 || minimumSecurityLevel > 4) {
    throw new Error("The maintenance level must be between 0 and 4.");
  }
  await execute(`UPDATE ${schema.auth}.\`realmlist\` SET allowedSecurityLevel = ? WHERE id = ?`, [
    minimumSecurityLevel,
    env.realm.id,
  ]);
}

/** An in-game announcement. Console-only by nature: there is nowhere to store it. */
export async function announce(message: string): Promise<SoapAttempt> {
  return trySoap(`announce ${textArg(message, 255)}`);
}

export interface RecentLogin {
  username: string;
  accountId: number;
  lastLogin: Date | null;
  lastIp: string | null;
}

export async function recentLogins(limit = 10): Promise<RecentLogin[]> {
  const rows = await query<RowDataPacket & { id: number; username: string; last_login: Date | null; last_ip: string }>(
    `SELECT id, username, last_login, last_ip
       FROM ${schema.auth}.\`account\`
      WHERE last_login IS NOT NULL
      ORDER BY last_login DESC
      LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}`,
  );
  return rows.map((row) => ({
    accountId: row.id,
    username: row.username,
    lastLogin: row.last_login,
    lastIp: row.last_ip || null,
  }));
}
