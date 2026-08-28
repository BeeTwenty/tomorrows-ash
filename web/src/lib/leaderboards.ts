import type { RowDataPacket } from "mysql2";
import { columnsOf, schema, tablesExist, tryQuery } from "./db";
import { env, isDemo } from "./env";
import { demoLeaderboards } from "./demo";
import { formatDuration, formatNumber, pluralise } from "./format";
import { visibleCharacter } from "./visibility";
import { factionOf } from "./wow";
import type { Leaderboard, LeaderboardEntry } from "./types";

/**
 * Realm leaderboards.
 *
 * "Deepest builds" is the one that only makes sense here: with no classes to
 * compare, the closest thing to a ladder is how much of the skill budget a
 * character has actually committed. It appears as soon as the classless tables
 * exist and explains itself when they do not.
 */

const BOARD_SIZE = 15;

interface LeaderRow extends RowDataPacket {
  guid: number;
  name: string;
  level: number;
  class: number;
  race: number;
  value: number;
  sub: string | null;
}

interface GuildRow extends RowDataPacket {
  name: string;
  members: number;
  leader: string | null;
}

function toEntries(rows: LeaderRow[], display: (row: LeaderRow) => string): LeaderboardEntry[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    name: row.name,
    guid: row.guid,
    level: row.level,
    chassis: row.class,
    race: row.race,
    faction: factionOf(row.race),
    value: Number(row.value),
    display: display(row),
    sub: row.sub,
  }));
}

async function characterBoard(
  label: string,
  valueExpr: string,
  orderExpr: string,
  display: (row: LeaderRow) => string,
): Promise<LeaderboardEntry[]> {
  const visible = visibleCharacter("c");
  const rows = await tryQuery<LeaderRow>(
    `leaderboard ${label}`,
    `SELECT c.guid, c.name, c.level, c.class, c.race,
            ${valueExpr} AS value,
            g.name AS sub
       FROM ${schema.chars}.\`characters\` c
       LEFT JOIN ${schema.chars}.\`guild_member\` gm ON gm.guid = c.guid
       LEFT JOIN ${schema.chars}.\`guild\` g ON g.guildid = gm.guildid
      WHERE c.level >= ? AND ${visible.sql}
      ORDER BY ${orderExpr}
      LIMIT ${BOARD_SIZE}`,
    [env.armory.minLevelForLeaderboards, ...visible.params],
  );
  return toEntries(rows ?? [], display);
}

async function buildDepthBoard(): Promise<Leaderboard> {
  // Ranked on the module's own purchase rows rather than a summary table, so
  // the board works from the moment characters start buying nodes.
  const present = await tablesExist(env.db.characters, ["classless_character_node"]);
  if (!present) {
    return {
      key: "builds",
      title: "Deepest builds",
      blurb: "Most skill points committed - the classless realm's version of a ladder.",
      entries: [],
      unavailable:
        "This board fills in once the classless system is live and characters start buying abilities.",
    };
  }

  // `cost_paid` is Phase 2; before it, every purchased node counted as one.
  const columns = await columnsOf(env.db.characters, "classless_character_node");
  const spentExpr = columns.has("cost_paid") ? "SUM(ccn.`cost_paid`)" : "COUNT(*)";

  const visible = visibleCharacter("c");
  const rows = await tryQuery<LeaderRow>(
    "leaderboard builds",
    `SELECT c.guid, c.name, c.level, c.class, c.race,
            ${spentExpr} AS value,
            g.name AS sub
       FROM ${schema.chars}.\`classless_character_node\` ccn
       JOIN ${schema.chars}.\`characters\` c ON c.guid = ccn.guid
       LEFT JOIN ${schema.chars}.\`guild_member\` gm ON gm.guid = c.guid
       LEFT JOIN ${schema.chars}.\`guild\` g ON g.guildid = gm.guildid
      WHERE ${visible.sql}
      GROUP BY c.guid, c.name, c.level, c.class, c.race, g.name
      ORDER BY value DESC, c.level DESC
      LIMIT ${BOARD_SIZE}`,
    visible.params,
  );

  return {
    key: "builds",
    title: "Deepest builds",
    blurb: "Most skill points committed - the classless realm's version of a ladder.",
    entries: toEntries(rows ?? [], (row) => `${formatNumber(row.value)} points`),
    unavailable: null,
  };
}

async function guildBoard(): Promise<Leaderboard> {
  const rows = await tryQuery<GuildRow>(
    "leaderboard guilds",
    `SELECT g.name AS name, COUNT(gm.guid) AS members, leader.name AS leader
       FROM ${schema.chars}.\`guild\` g
       JOIN ${schema.chars}.\`guild_member\` gm ON gm.guildid = g.guildid
       LEFT JOIN ${schema.chars}.\`characters\` leader ON leader.guid = g.leaderguid
      GROUP BY g.guildid, g.name, leader.name
      ORDER BY members DESC, g.name ASC
      LIMIT ${BOARD_SIZE}`,
  );

  return {
    key: "guilds",
    title: "Largest guilds",
    blurb: "Who is playing together.",
    entries: (rows ?? []).map((row, index) => ({
      rank: index + 1,
      name: row.name,
      guid: null,
      level: null,
      chassis: null,
      race: null,
      faction: "neutral" as const,
      value: Number(row.members),
      display: pluralise(Number(row.members), "member"),
      sub: row.leader ? `led by ${row.leader}` : null,
    })),
    unavailable: null,
  };
}

let cache: { value: Leaderboard[]; at: number } | null = null;

export async function getLeaderboards(): Promise<Leaderboard[]> {
  if (isDemo) return demoLeaderboards();

  const now = Date.now();
  if (cache && now - cache.at < env.armory.cacheSeconds * 1000) return cache.value;

  const [level, builds, kills, played, guilds] = await Promise.all([
    characterBoard(
      "level",
      "c.level",
      "c.level DESC, c.totaltime DESC",
      (row) => `Level ${row.value}`,
    ),
    buildDepthBoard(),
    characterBoard(
      "kills",
      "c.totalKills",
      "c.totalKills DESC, c.level DESC",
      (row) => formatNumber(row.value),
    ),
    characterBoard(
      "played",
      "c.totaltime",
      "c.totaltime DESC, c.level DESC",
      (row) => formatDuration(row.value),
    ),
    guildBoard(),
  ]);

  const value: Leaderboard[] = [
    {
      key: "level",
      title: "Furthest along",
      blurb: "Highest level, then most time in the world.",
      entries: level,
      unavailable: null,
    },
    builds,
    {
      key: "kills",
      title: "Most kills",
      blurb: "Honourable kills, all time.",
      entries: kills,
      unavailable: null,
    },
    {
      key: "played",
      title: "Most time in the world",
      blurb: "Total played time across the character's life.",
      entries: played,
      unavailable: null,
    },
    guilds,
  ];

  cache = { value, at: now };
  return value;
}
