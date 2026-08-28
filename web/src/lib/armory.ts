import type { RowDataPacket } from "mysql2";
import { schema, tryQuery } from "./db";
import { isDemo } from "./env";
import { demoOnline, demoProfile, demoSearch } from "./demo";
import { loadBuild } from "./build";
import { visibleCharacter } from "./visibility";
import { EQUIPMENT_SLOT_LABELS, POWER_NAMES, factionOf } from "./wow";
import type { CharacterProfile, CharacterStats, CharacterSummary, EquippedItem } from "./types";

/**
 * Character lookup.
 *
 * Two details drive the query shapes here:
 *
 *   - `characters.name` is stored with a *binary* collation, so a plain `=`
 *     is case-sensitive. The client always writes names in Title case, so
 *     canonicalising the search term keeps the `idx_name` index usable and
 *     still matches whatever the player typed.
 *   - Every public query goes through `visibleCharacter()`, which hides
 *     deleted characters and staff accounts. There is no code path that
 *     returns a character the site is not supposed to show.
 */

const SEARCH_LIMIT = 25;

/** "eMBERlyn" -> "Emberlyn", which is how the client stores it. */
export function canonicalName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface CharacterRow extends RowDataPacket {
  guid: number;
  name: string;
  race: number;
  class: number;
  gender: number;
  level: number;
  online: number;
  totaltime: number;
  logout_time: number;
  zone: number;
  totalKills: number;
  totalHonorPoints: number;
  guildName: string | null;
}

const CHARACTER_COLUMNS = `
  c.guid, c.name, c.race, c.class, c.gender, c.level, c.online,
  c.totaltime, c.logout_time, c.zone, c.totalKills, c.totalHonorPoints,
  g.name AS guildName`;

function guildJoin(): string {
  return `LEFT JOIN ${schema.chars}.\`guild_member\` gm ON gm.guid = c.guid
          LEFT JOIN ${schema.chars}.\`guild\` g ON g.guildid = gm.guildid`;
}

function toSummary(row: CharacterRow): CharacterSummary {
  return {
    guid: row.guid,
    name: row.name,
    level: row.level,
    race: row.race,
    chassis: row.class,
    gender: row.gender,
    faction: factionOf(row.race),
    guildName: row.guildName,
    online: row.online === 1,
    lastLogin: row.logout_time > 0 ? new Date(row.logout_time * 1000) : null,
    playedSeconds: row.totaltime,
  };
}

export async function searchCharacters(term: string): Promise<CharacterSummary[]> {
  const canonical = canonicalName(term);
  if (isDemo) return demoSearch(term);
  if (!canonical) return [];

  const visible = visibleCharacter("c");
  const rows = await tryQuery<CharacterRow>(
    "armory search",
    `SELECT ${CHARACTER_COLUMNS}
       FROM ${schema.chars}.\`characters\` c
       ${guildJoin()}
      WHERE c.name LIKE ? ESCAPE '\\\\'
        AND ${visible.sql}
      ORDER BY c.level DESC, c.name ASC
      LIMIT ${SEARCH_LIMIT}`,
    [`${escapeLike(canonical)}%`, ...visible.params],
  );

  return (rows ?? []).map(toSummary);
}

interface StatsRow extends RowDataPacket {
  maxhealth: number;
  maxpower1: number;
  maxpower2: number;
  maxpower3: number;
  maxpower4: number;
  maxpower7: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
  armor: number;
  attackPower: number;
  spellPower: number;
  resilience: number;
  critPct: number;
  spellCritPct: number;
  dodgePct: number;
  parryPct: number;
  blockPct: number;
}

interface GearRow extends RowDataPacket {
  slot: number;
  entry: number;
  name: string;
  Quality: number;
  ItemLevel: number;
}

interface CountRow extends RowDataPacket {
  n: number;
}

/**
 * The largest non-zero power pool is the character's primary resource. Reading
 * it from the data rather than from the class is the classless-correct move:
 * a chassis can end up running on a resource its class never used.
 */
function primaryPower(row: StatsRow): { name: string; value: number } {
  const pools: Array<[string, number]> = [
    [POWER_NAMES[0], row.maxpower1],
    [POWER_NAMES[1], row.maxpower2],
    [POWER_NAMES[2], row.maxpower3],
    [POWER_NAMES[3], row.maxpower4],
    [POWER_NAMES[6], row.maxpower7],
  ];
  const best = pools.reduce((top, pool) => (pool[1] > top[1] ? pool : top), ["Mana", 0] as [string, number]);
  return { name: best[0], value: best[1] };
}

export async function getCharacterProfile(name: string): Promise<CharacterProfile | null> {
  if (isDemo) return demoProfile(name);

  const canonical = canonicalName(name);
  if (!canonical) return null;

  const visible = visibleCharacter("c");
  const rows = await tryQuery<CharacterRow>(
    "armory profile",
    `SELECT ${CHARACTER_COLUMNS}
       FROM ${schema.chars}.\`characters\` c
       ${guildJoin()}
      WHERE c.name = ? AND ${visible.sql}
      LIMIT 1`,
    [canonical, ...visible.params],
  );

  const row = rows?.[0];
  if (!row) return null;

  const [statsRows, gearRows, achievementRows, build] = await Promise.all([
    tryQuery<StatsRow>(
      "armory stats",
      `SELECT maxhealth, maxpower1, maxpower2, maxpower3, maxpower4, maxpower7,
              strength, agility, stamina, intellect, spirit, armor,
              attackPower, spellPower, resilience,
              critPct, spellCritPct, dodgePct, parryPct, blockPct
         FROM ${schema.chars}.\`character_stats\` WHERE guid = ?`,
      [row.guid],
    ),
    tryQuery<GearRow>(
      "armory gear",
      `SELECT ci.slot, it.entry, it.name, it.Quality, it.ItemLevel
         FROM ${schema.chars}.\`character_inventory\` ci
         JOIN ${schema.chars}.\`item_instance\` ii ON ii.guid = ci.item
         JOIN ${schema.world}.\`item_template\` it ON it.entry = ii.itemEntry
        WHERE ci.guid = ? AND ci.bag = 0 AND ci.slot <= 18
        ORDER BY ci.slot`,
      [row.guid],
    ),
    tryQuery<CountRow>(
      "armory achievements",
      `SELECT COUNT(*) AS n FROM ${schema.chars}.\`character_achievement\` WHERE guid = ?`,
      [row.guid],
    ),
    loadBuild(row.guid, row.level),
  ]);

  const statsRow = statsRows?.[0] ?? null;
  let stats: CharacterStats | null = null;
  if (statsRow) {
    const power = primaryPower(statsRow);
    stats = {
      maxHealth: statsRow.maxhealth,
      primaryPowerName: power.name,
      primaryPowerMax: power.value,
      strength: statsRow.strength,
      agility: statsRow.agility,
      stamina: statsRow.stamina,
      intellect: statsRow.intellect,
      spirit: statsRow.spirit,
      armor: statsRow.armor,
      attackPower: statsRow.attackPower,
      spellPower: statsRow.spellPower,
      resilience: statsRow.resilience,
      critPct: statsRow.critPct,
      spellCritPct: statsRow.spellCritPct,
      dodgePct: statsRow.dodgePct,
      parryPct: statsRow.parryPct,
      blockPct: statsRow.blockPct,
    };
  }

  const gear: EquippedItem[] = (gearRows ?? []).map((item) => ({
    slot: item.slot,
    label: EQUIPMENT_SLOT_LABELS[item.slot] ?? `Slot ${item.slot}`,
    entry: item.entry,
    name: item.name,
    quality: item.Quality,
    itemLevel: item.ItemLevel,
  }));

  return {
    ...toSummary(row),
    zone: row.zone,
    totalKills: row.totalKills,
    honorPoints: row.totalHonorPoints,
    achievements: achievementRows?.[0]?.n ?? null,
    stats,
    gear,
    build,
  };
}

/** The handful of players currently in the world, for the armory landing strip. */
export async function getOnlineCharacters(limit = 12): Promise<CharacterSummary[]> {
  if (isDemo) return demoOnline().slice(0, limit);

  const visible = visibleCharacter("c");
  const rows = await tryQuery<CharacterRow>(
    "armory online",
    `SELECT ${CHARACTER_COLUMNS}
       FROM ${schema.chars}.\`characters\` c
       ${guildJoin()}
      WHERE c.online = 1 AND ${visible.sql}
      ORDER BY c.level DESC, c.name ASC
      LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`,
    visible.params,
  );

  return (rows ?? []).map(toSummary);
}

/** Characters on one account, for the signed-in dashboard. */
export async function getAccountCharacters(accountId: number): Promise<CharacterSummary[]> {
  if (isDemo) return demoOnline().slice(0, 3);

  const rows = await tryQuery<CharacterRow>(
    "account characters",
    `SELECT ${CHARACTER_COLUMNS}
       FROM ${schema.chars}.\`characters\` c
       ${guildJoin()}
      WHERE c.account = ? AND c.\`deleteDate\` IS NULL
      ORDER BY c.level DESC, c.name ASC
      LIMIT 20`,
    [accountId],
  );

  return (rows ?? []).map(toSummary);
}
