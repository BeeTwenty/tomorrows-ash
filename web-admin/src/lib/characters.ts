import type { RowDataPacket } from "mysql2";
import { chassisName, factionOf, genderName, raceName, zoneName } from "@shared/wow";
import { execute, query, queryOne, schema, type SqlParam } from "./db";
import { characterName, trySoap, type SoapAttempt } from "./soap";

/**
 * Characters, and the one rule that governs every write to them.
 *
 * ## The online rule
 *
 * While a character is online, the worldserver holds their state in memory and
 * writes it back on logout or on its periodic save. A direct UPDATE to
 * `characters` in that window is not a race that usually works - it is a change
 * that will be overwritten, with no error anywhere. A support action that
 * silently does nothing is worse than one that refuses.
 *
 * So: every mutation here checks `online` first and refuses if it is set,
 * offering the console instead. `assertOffline` is that check, and it is not
 * optional even for "harmless" fields.
 *
 * `character.online` can also be stale after a crash. That is why the refusal
 * says which it is and offers the console path either way, rather than being a
 * dead end - and why nothing here tries to "fix" the flag.
 */

export interface CharacterSummary {
  guid: number;
  accountId: number;
  accountName: string | null;
  name: string;
  race: number;
  raceName: string;
  chassis: number;
  chassisName: string;
  faction: string;
  gender: string;
  level: number;
  money: number;
  online: boolean;
  zone: number;
  zoneName: string;
  map: number;
  totalTime: number;
  logoutTime: Date | null;
  deleted: boolean;
  banned: boolean;
}

interface CharacterRow extends RowDataPacket {
  guid: number;
  account: number;
  account_name: string | null;
  name: string;
  race: number;
  class: number;
  gender: number;
  level: number;
  money: number;
  online: number;
  zone: number;
  map: number;
  totaltime: number;
  logout_time: number;
  deleteDate: number | null;
  banned: number;
}

const SELECT_CHARACTER = `
  SELECT c.guid, c.account, a.username AS account_name, c.name, c.race, c.class, c.gender,
         c.level, c.money, c.online, c.zone, c.map, c.totaltime, c.logout_time, c.deleteDate,
         (SELECT COUNT(*) FROM ${schema.chars}.\`character_banned\` cb
           WHERE cb.guid = c.guid AND cb.active = 1
             AND (cb.unbandate > UNIX_TIMESTAMP() OR cb.unbandate = cb.bandate)) AS banned
    FROM ${schema.chars}.\`characters\` c
    LEFT JOIN ${schema.auth}.\`account\` a ON a.id = c.account`;

function toSummary(row: CharacterRow): CharacterSummary {
  return {
    guid: row.guid,
    accountId: row.account,
    accountName: row.account_name,
    name: row.name,
    race: row.race,
    raceName: raceName(row.race),
    // The realm is classless, so `class` is a chassis - the body type the
    // character was created with, not a kit. web/src/lib/wow.ts owns that
    // vocabulary and both apps share it rather than each inventing one.
    chassis: row.class,
    chassisName: chassisName(row.class),
    faction: factionOf(row.race),
    gender: genderName(row.gender),
    level: row.level,
    money: row.money,
    online: row.online > 0,
    zone: row.zone,
    zoneName: zoneName(row.zone),
    map: row.map,
    totalTime: row.totaltime,
    logoutTime: row.logout_time > 0 ? new Date(row.logout_time * 1000) : null,
    deleted: row.deleteDate !== null,
    banned: row.banned > 0,
  };
}

export interface CharacterSearch {
  q?: string;
  status?: "all" | "online" | "banned" | "deleted";
  accountId?: number;
  limit?: number;
  offset?: number;
}

export async function searchCharacters(search: CharacterSearch): Promise<{ rows: CharacterSummary[]; total: number }> {
  const limit = Math.min(200, Math.max(1, search.limit ?? 50));
  const offset = Math.max(0, search.offset ?? 0);

  const where: string[] = [];
  const params: SqlParam[] = [];

  // Unlike the public armory, deleted characters are visible here by default's
  // opposite: they are hidden unless asked for, because a support query for a
  // name should not silently return the deleted one.
  if (search.status !== "deleted") where.push("c.deleteDate IS NULL");

  const q = search.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      where.push("(c.guid = ? OR c.name LIKE ?)");
      params.push(Number(q), `%${q}%`);
    } else {
      where.push("(c.name LIKE ? OR a.username LIKE ?)");
      params.push(`%${q}%`, `%${q.toUpperCase()}%`);
    }
  }

  if (search.accountId !== undefined) {
    where.push("c.account = ?");
    params.push(search.accountId);
  }

  if (search.status === "online") where.push("c.online > 0");
  if (search.status === "deleted") where.push("c.deleteDate IS NOT NULL");
  if (search.status === "banned") {
    where.push(
      `EXISTS (SELECT 1 FROM ${schema.chars}.\`character_banned\` cb
                WHERE cb.guid = c.guid AND cb.active = 1
                  AND (cb.unbandate > UNIX_TIMESTAMP() OR cb.unbandate = cb.bandate))`,
    );
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<CharacterRow>(
    `${SELECT_CHARACTER} ${clause} ORDER BY c.level DESC, c.name ASC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const counted = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM ${schema.chars}.\`characters\` c
       LEFT JOIN ${schema.auth}.\`account\` a ON a.id = c.account ${clause}`,
    params,
  );

  return { rows: rows.map(toSummary), total: Number(counted[0]?.n ?? 0) };
}

export async function getCharacter(guid: number): Promise<CharacterSummary | null> {
  const row = await queryOne<CharacterRow>(`${SELECT_CHARACTER} WHERE c.guid = ? LIMIT 1`, [guid]);
  return row ? toSummary(row) : null;
}

export class OnlineCharacterError extends Error {
  constructor(name: string) {
    super(
      `${name} is online. The worldserver owns their data while they are in the world and would ` +
        `overwrite a direct edit, so the panel will not make one. Use a console action, or ask them ` +
        `to log out.`,
    );
    this.name = "OnlineCharacterError";
  }
}

/** Re-read `online` inside the write path; a page rendered a minute ago is not evidence. */
async function assertOffline(guid: number): Promise<CharacterSummary> {
  const character = await getCharacter(guid);
  if (!character) throw new Error(`No character with guid ${guid}.`);
  if (character.online) throw new OnlineCharacterError(character.name);
  return character;
}

/** Fields the panel will edit directly, and the bounds each must stay inside. */
export interface CharacterEdit {
  level?: number;
  money?: number;
}

export async function editCharacter(guid: number, edit: CharacterEdit): Promise<{ before: CharacterEdit; after: CharacterEdit }> {
  const character = await assertOffline(guid);

  const sets: string[] = [];
  const params: SqlParam[] = [];
  const before: CharacterEdit = {};
  const after: CharacterEdit = {};

  if (edit.level !== undefined) {
    if (!Number.isInteger(edit.level) || edit.level < 1 || edit.level > 80) {
      throw new Error("Level must be between 1 and 80.");
    }
    /**
     * Level is written without touching xp, and that is a real limitation, not
     * an oversight: the core recomputes stats, talent points and xp-to-next
     * from level at load, but a character whose xp exceeds the new level's
     * requirement will immediately level back up. The UI says so. A correct
     * level change on a live realm is `.character level`, through the console.
     */
    sets.push("level = ?", "xp = 0");
    params.push(edit.level);
    before.level = character.level;
    after.level = edit.level;
  }

  if (edit.money !== undefined) {
    // Copper. The client's own ceiling is 214748 gold - past it the value wraps.
    if (!Number.isInteger(edit.money) || edit.money < 0 || edit.money > 2_147_483_647) {
      throw new Error("Money must be between 0 and 2147483647 copper.");
    }
    sets.push("money = ?");
    params.push(edit.money);
    before.money = character.money;
    after.money = edit.money;
  }

  if (sets.length === 0) throw new Error("Nothing to change.");

  params.push(guid);
  await execute(`UPDATE ${schema.chars}.\`characters\` SET ${sets.join(", ")} WHERE guid = ? AND online = 0`, params);

  return { before, after };
}

/**
 * Queue a flag the character picks up at their next login.
 *
 * This is the one class of character change that is safe to make while they are
 * online: `at_login` is read when the session starts, so setting it now takes
 * effect next time either way. It is also how the core's own `.character rename`
 * works.
 */
export const AT_LOGIN = {
  rename: 0x01,
  resetSpells: 0x02,
  resetTalents: 0x04,
  customize: 0x08,
  changeFaction: 0x40,
  changeRace: 0x80,
} as const;

export type AtLoginFlag = keyof typeof AT_LOGIN;

export async function queueAtLogin(guid: number, flag: AtLoginFlag): Promise<void> {
  await execute(`UPDATE ${schema.chars}.\`characters\` SET at_login = at_login | ? WHERE guid = ?`, [
    AT_LOGIN[flag],
    guid,
  ]);
}

/**
 * Console actions.
 *
 * Each one needs the worldserver. They are separated from the direct writes
 * above so the difference is visible in the call site: if it is here, it does
 * nothing when SOAP is off, and the caller has to say so.
 */
export async function kickCharacter(name: string): Promise<SoapAttempt> {
  return trySoap(`kick ${characterName(name)}`);
}

export async function reviveCharacter(name: string): Promise<SoapAttempt> {
  return trySoap(`revive ${characterName(name)}`);
}

export async function summonCharacter(name: string): Promise<SoapAttempt> {
  return trySoap(`summon ${characterName(name)}`);
}

/** `.teleport name <location>` - the location comes from `game_tele`, so it is looked up, never typed through. */
export async function teleportCharacter(name: string, teleportId: number): Promise<SoapAttempt> {
  const destination = await queryOne<RowDataPacket & { name: string }>(
    `SELECT name FROM ${schema.world}.\`game_tele\` WHERE id = ? LIMIT 1`,
    [teleportId],
  );
  if (!destination) return { attempted: false, ok: false, output: null, error: "No such teleport destination." };
  return trySoap(`teleport name ${characterName(name)} ${destination.name}`);
}

export async function teleportDestinations(search: string, limit = 25): Promise<{ id: number; name: string }[]> {
  const rows = await query<RowDataPacket & { id: number; name: string }>(
    `SELECT id, name FROM ${schema.world}.\`game_tele\`
      WHERE name LIKE ? ORDER BY name LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}`,
    [`%${search.trim()}%`],
  );
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export interface EquippedItem {
  slot: number;
  itemEntry: number;
  name: string | null;
  quality: number | null;
  itemLevel: number | null;
  count: number;
}

/**
 * What the character is wearing.
 *
 * `character_inventory.slot` is the equipment slot only when `bag = 0` and
 * `slot < 19`; everything else is backpack and bags. The join to `item_instance`
 * is what turns a guid into an item entry.
 */
export async function equippedItems(guid: number): Promise<EquippedItem[]> {
  const rows = await query<RowDataPacket & {
    slot: number;
    itemEntry: number;
    count: number;
    name: string | null;
    Quality: number | null;
    ItemLevel: number | null;
  }>(
    `SELECT ci.slot, ii.itemEntry, ii.count, it.name, it.Quality, it.ItemLevel
       FROM ${schema.chars}.\`character_inventory\` ci
       JOIN ${schema.chars}.\`item_instance\` ii ON ii.guid = ci.item
       LEFT JOIN ${schema.world}.\`item_template\` it ON it.entry = ii.itemEntry
      WHERE ci.guid = ? AND ci.bag = 0 AND ci.slot < 19
      ORDER BY ci.slot`,
    [guid],
  );

  return rows.map((row) => ({
    slot: row.slot,
    itemEntry: row.itemEntry,
    name: row.name,
    quality: row.Quality,
    itemLevel: row.ItemLevel,
    count: row.count,
  }));
}
