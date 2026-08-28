import { composeArchetype } from "./archetype";
import { treeColour } from "./build";
import { env } from "./env";
import { factionOf } from "./wow";
import type {
  CharacterBuild,
  CharacterProfile,
  CharacterSummary,
  EquippedItem,
  Leaderboard,
  RealmStatus,
} from "./types";

/**
 * A fully populated realm that does not exist.
 *
 * With no `DB_HOST` configured the site runs in demo mode: every page renders
 * with plausible data so the design, the armory layout and the build display
 * can be reviewed long before a realm is up. Nothing here ever touches a
 * database, and the site says clearly on every affected page that the data is
 * illustrative.
 *
 * The data is deterministic - the same character always looks the same - so
 * screenshots and server-rendered output stay stable between requests.
 */

function seedFrom(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** mulberry32 - small, fast, and identical across runs. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DEMO_TREES = [
  { id: 1, name: "Fire", description: "Direct damage that grows the longer a fight runs." },
  { id: 2, name: "Frost", description: "Control, slows and survivability." },
  { id: 3, name: "Shadow", description: "Damage over time and life drain." },
  { id: 4, name: "Sword Mastery", description: "Melee weapon skill and openers." },
  { id: 5, name: "Warding", description: "Armour, blocks and damage reduction." },
  { id: 6, name: "Mending", description: "Healing over time and emergency saves." },
  { id: 7, name: "Stealth", description: "Positioning, evasion and burst from hiding." },
  { id: 8, name: "Beast Bond", description: "Pets, taming and shared strength." },
];

const DEMO_NODE_NAMES = [
  "Kindling", "Coalwalk", "Ashen Grasp", "Second Burning", "Cinder Ward",
  "Long Ember", "Banked Heat", "Emberfall", "Slow Burn", "Rekindle",
];

interface DemoSeed {
  name: string;
  race: number;
  chassis: number;
  level: number;
  guild: string | null;
  /** [treeId, points] pairs. */
  spread: Array<[number, number]>;
  online?: boolean;
  playedHours: number;
  kills: number;
}

const DEMO_CHARACTERS: DemoSeed[] = [
  { name: "Emberlyn", race: 1, chassis: 8, level: 80, guild: "The Long Ash", spread: [[1, 26], [4, 18]], online: true, playedHours: 214, kills: 1_842 },
  { name: "Sorrowmark", race: 5, chassis: 4, level: 80, guild: "Nightfall Company", spread: [[7, 24], [3, 16], [4, 6]], online: true, playedHours: 189, kills: 2_611 },
  { name: "Cairnhold", race: 3, chassis: 1, level: 80, guild: "The Long Ash", spread: [[5, 30], [6, 8]], playedHours: 240, kills: 903 },
  { name: "Vessiline", race: 11, chassis: 5, level: 79, guild: "Kindled", spread: [[6, 22], [2, 14], [1, 4]], online: true, playedHours: 151, kills: 402 },
  { name: "Draughtwren", race: 7, chassis: 9, level: 77, guild: null, spread: [[3, 19], [8, 15], [1, 5]], playedHours: 96, kills: 511 },
  { name: "Ashkettle", race: 6, chassis: 7, level: 80, guild: "Nightfall Company", spread: [[1, 14], [2, 12], [5, 11], [6, 9]], playedHours: 176, kills: 1_204 },
  { name: "Ilvenna", race: 4, chassis: 11, level: 74, guild: "Kindled", spread: [[8, 21], [6, 13]], online: true, playedHours: 88, kills: 236 },
  { name: "Bellowsgate", race: 2, chassis: 1, level: 80, guild: "The Long Ash", spread: [[4, 25], [1, 17]], playedHours: 203, kills: 3_140 },
  { name: "Quietstep", race: 10, chassis: 4, level: 68, guild: null, spread: [[7, 28]], online: true, playedHours: 61, kills: 744 },
  { name: "Marrowlight", race: 5, chassis: 5, level: 71, guild: "Kindled", spread: [[6, 16], [3, 15]], playedHours: 74, kills: 168 },
  { name: "Torchbearer", race: 1, chassis: 2, level: 63, guild: null, spread: [[1, 12], [5, 10], [6, 6]], playedHours: 42, kills: 97 },
  { name: "Fenwarden", race: 3, chassis: 3, level: 58, guild: "Nightfall Company", spread: [[8, 14], [7, 9]], playedHours: 38, kills: 320 },
  { name: "Hollowvane", race: 8, chassis: 9, level: 52, guild: null, spread: [[3, 13], [2, 5]], playedHours: 29, kills: 145 },
  { name: "Sootmantle", race: 6, chassis: 1, level: 44, guild: "The Long Ash", spread: [[5, 11], [4, 7]], playedHours: 24, kills: 88 },
  { name: "Rekindra", race: 11, chassis: 8, level: 37, guild: null, spread: [[1, 9], [6, 4]], online: true, playedHours: 16, kills: 21 },
  { name: "Gravewick", race: 5, chassis: 6, level: 80, guild: "Nightfall Company", spread: [[3, 20], [5, 14], [4, 6]], playedHours: 198, kills: 1_977 },
];

const DEMO_ZONES = [1519, 1637, 4395, 210, 3711, 67, 33, 12, 3521];

function buildFromSpread(seed: DemoSeed): CharacterBuild {
  const random = rng(seedFrom(seed.name));
  const spent = seed.spread.reduce((sum, [, points]) => sum + points, 0);

  const trees = seed.spread
    .map(([treeId, points], index) => {
      const definition = DEMO_TREES.find((t) => t.id === treeId)!;
      const nodeCount = Math.max(2, Math.round(points / 6));
      const nodes = Array.from({ length: nodeCount }, (_, i) => {
        const rank = Math.max(1, Math.round(random() * 3));
        return {
          id: treeId * 100 + i,
          name: DEMO_NODE_NAMES[(treeId + i) % DEMO_NODE_NAMES.length]!,
          description: null,
          spellId: 10_000 + treeId * 50 + i,
          tier: i + 1,
          rank,
          maxRank: 3,
          pointsSpent: rank,
          granted: true,
        };
      });
      return {
        id: treeId,
        name: definition.name,
        description: definition.description,
        points,
        share: points / spent,
        colour: treeColour(index),
        nodes,
      };
    })
    .sort((a, b) => b.points - a.points);

  return {
    mode: "classless",
    pointsSpent: spent,
    pointsTotal: Math.max(spent, Math.round(seed.level * 0.6)),
    trees,
    archetype: composeArchetype(trees.map((t) => ({ name: t.name, points: t.points }))),
    talentsRecorded: null,
    abilitiesKnown: null,
    note: null,
  };
}

function toSummary(seed: DemoSeed): CharacterSummary {
  const random = rng(seedFrom(seed.name) ^ 0x9e37);
  return {
    guid: (seedFrom(seed.name) % 90_000) + 1_000,
    name: seed.name,
    level: seed.level,
    race: seed.race,
    chassis: seed.chassis,
    gender: random() > 0.5 ? 1 : 0,
    faction: factionOf(seed.race),
    guildName: seed.guild,
    online: seed.online ?? false,
    lastLogin: seed.online
      ? new Date()
      : new Date(Date.now() - Math.floor(random() * 12 * 86_400_000)),
    playedSeconds: seed.playedHours * 3_600,
  };
}

const DEMO_GEAR: Array<[number, string, number, number]> = [
  [0, "Ash-Scarred Hood", 4, 232],
  [1, "Chain of Small Mercies", 3, 213],
  [2, "Mantle of the Long Burn", 4, 226],
  [14, "Cloak of Settled Smoke", 3, 200],
  [4, "Breastplate of the Rekindled", 4, 232],
  [8, "Bracers of Banked Heat", 3, 213],
  [9, "Grips of the Second Morning", 4, 226],
  [5, "Girdle of Quiet Coals", 3, 200],
  [6, "Legguards of the Ash Road", 4, 232],
  [7, "Boots of the Coalwalker", 3, 213],
  [10, "Band of Kept Fire", 4, 226],
  [11, "Signet of Tomorrow", 3, 200],
  [12, "Vial of Slow Burning", 4, 226],
  [13, "Ember in Amber", 5, 245],
  [15, "Cindercleaver", 4, 232],
  [16, "Ashen Bulwark", 3, 213],
  [17, "Longsight Bow", 3, 200],
];

function demoGear(seed: DemoSeed): EquippedItem[] {
  const scale = seed.level / 80;
  return DEMO_GEAR.map(([slot, name, quality, ilvl]) => ({
    slot,
    label: "",
    entry: 40_000 + slot,
    name,
    quality,
    itemLevel: Math.max(1, Math.round(ilvl * scale)),
  }));
}

export function demoRealmStatus(): RealmStatus {
  const online = DEMO_CHARACTERS.filter((c) => c.online);
  const alliance = online.filter((c) => factionOf(c.race) === "alliance").length;
  const horde = online.filter((c) => factionOf(c.race) === "horde").length;
  return {
    name: env.realm.name,
    online: true,
    authOnline: true,
    worldOnline: true,
    playersOnline: alliance + horde,
    alliance,
    horde,
    peakPlayers: 42,
    uptimeSeconds: 3_600 * 27 + 840,
    startedAt: new Date(Date.now() - (3_600 * 27 + 840) * 1000),
    revision: "AzerothCore rev. demo",
    charactersTotal: DEMO_CHARACTERS.length,
    accountsTotal: 11,
    address: env.realm.address,
    authPort: env.realm.authPort,
    worldPort: env.realm.worldPort,
    checkedAt: new Date(),
    degraded: null,
  };
}

export function demoSearch(term: string): CharacterSummary[] {
  const needle = term.trim().toLowerCase();
  return DEMO_CHARACTERS.filter((c) => !needle || c.name.toLowerCase().includes(needle))
    .slice(0, 25)
    .map(toSummary);
}

export function demoProfile(name: string): CharacterProfile | null {
  const seed = DEMO_CHARACTERS.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (!seed) return null;

  const summary = toSummary(seed);
  const random = rng(seedFrom(seed.name) ^ 0x51ed);
  const scale = seed.level / 80;

  return {
    ...summary,
    zone: DEMO_ZONES[seedFrom(seed.name) % DEMO_ZONES.length]!,
    totalKills: seed.kills,
    honorPoints: Math.round(seed.kills * 7.5),
    achievements: Math.round(40 + random() * 260),
    stats: {
      maxHealth: Math.round(4_200 + 18_000 * scale),
      primaryPowerName: seed.chassis === 1 || seed.chassis === 4 ? "Rage" : "Mana",
      primaryPowerMax: Math.round(1_000 + 15_000 * scale),
      strength: Math.round(20 + 180 * scale),
      agility: Math.round(20 + 160 * scale),
      stamina: Math.round(22 + 210 * scale),
      intellect: Math.round(20 + 190 * scale),
      spirit: Math.round(20 + 150 * scale),
      armor: Math.round(300 + 12_000 * scale),
      attackPower: Math.round(60 + 2_400 * scale),
      spellPower: Math.round(10 + 1_900 * scale),
      resilience: Math.round(random() * 400 * scale),
      critPct: 8 + random() * 22,
      spellCritPct: 6 + random() * 24,
      dodgePct: 3 + random() * 14,
      parryPct: random() * 12,
      blockPct: random() * 16,
    },
    gear: demoGear(seed),
    build: buildFromSpread(seed),
  };
}

export function demoLeaderboards(): Leaderboard[] {
  const byLevel = [...DEMO_CHARACTERS].sort((a, b) => b.level - a.level || b.playedHours - a.playedHours);
  const byKills = [...DEMO_CHARACTERS].sort((a, b) => b.kills - a.kills);
  const byPlayed = [...DEMO_CHARACTERS].sort((a, b) => b.playedHours - a.playedHours);
  const byPoints = [...DEMO_CHARACTERS].sort(
    (a, b) =>
      b.spread.reduce((s, [, p]) => s + p, 0) - a.spread.reduce((s, [, p]) => s + p, 0),
  );

  const entry = (seed: DemoSeed, index: number, value: number, display: string, sub: string | null) => ({
    rank: index + 1,
    name: seed.name,
    guid: (seedFrom(seed.name) % 90_000) + 1_000,
    level: seed.level,
    chassis: seed.chassis,
    race: seed.race,
    faction: factionOf(seed.race),
    value,
    display,
    sub,
  });

  return [
    {
      key: "level",
      title: "Furthest along",
      blurb: "Highest level, then most time in the world.",
      entries: byLevel.slice(0, 10).map((s, i) => entry(s, i, s.level, `Level ${s.level}`, s.guild)),
      unavailable: null,
    },
    {
      key: "builds",
      title: "Deepest builds",
      blurb: "Most skill points committed. A classless realm's answer to gear score.",
      entries: byPoints.slice(0, 10).map((s, i) => {
        const points = s.spread.reduce((sum, [, p]) => sum + p, 0);
        const archetype = composeArchetype(
          s.spread.map(([id, p]) => ({ name: DEMO_TREES.find((t) => t.id === id)!.name, points: p })),
        );
        return entry(s, i, points, `${points} points`, archetype.title);
      }),
      unavailable: null,
    },
    {
      key: "kills",
      title: "Most kills",
      blurb: "Honourable kills, all time.",
      entries: byKills.slice(0, 10).map((s, i) => entry(s, i, s.kills, s.kills.toLocaleString("en-GB"), s.guild)),
      unavailable: null,
    },
    {
      key: "played",
      title: "Most time in the world",
      blurb: "Total played time across the character's life.",
      entries: byPlayed
        .slice(0, 10)
        .map((s, i) => entry(s, i, s.playedHours * 3_600, `${s.playedHours}h`, s.guild)),
      unavailable: null,
    },
  ];
}

/** The armory's "who is on right now" strip. */
export function demoOnline(): CharacterSummary[] {
  return DEMO_CHARACTERS.filter((c) => c.online).map(toSummary);
}

export const DEMO_TREE_LIST = DEMO_TREES;
