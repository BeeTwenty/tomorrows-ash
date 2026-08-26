import type { Archetype } from "./archetype";
import type { Faction } from "./wow";

export interface RealmStatus {
  name: string;
  /** The realm counts as up when the worldserver answers. */
  online: boolean;
  authOnline: boolean;
  worldOnline: boolean;
  playersOnline: number;
  alliance: number;
  horde: number;
  /** uptime.maxplayers - the peak concurrent players of the current run. */
  peakPlayers: number | null;
  uptimeSeconds: number | null;
  startedAt: Date | null;
  revision: string | null;
  charactersTotal: number | null;
  accountsTotal: number | null;
  address: string;
  authPort: number;
  worldPort: number;
  checkedAt: Date;
  /** Set when the database could not be reached; the page says so out loud. */
  degraded: string | null;
}

export interface CharacterSummary {
  guid: number;
  name: string;
  level: number;
  race: number;
  chassis: number;
  gender: number;
  faction: Faction;
  guildName: string | null;
  online: boolean;
  lastLogin: Date | null;
  playedSeconds: number;
}

export interface EquippedItem {
  slot: number;
  label: string;
  entry: number;
  name: string;
  quality: number;
  itemLevel: number;
}

export interface CharacterStats {
  maxHealth: number;
  primaryPowerName: string;
  primaryPowerMax: number;
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

export interface BuildNode {
  id: number;
  name: string;
  description: string | null;
  spellId: number;
  tier: number;
  rank: number;
  maxRank: number | null;
  pointsSpent: number;
}

export interface BuildTree {
  id: number;
  name: string;
  description: string | null;
  points: number;
  /** Share of the character's spent points, 0..1. */
  share: number;
  colour: string;
  nodes: BuildNode[];
}

/**
 * `classless` - read from the module's own tables.
 * `interim`   - the classless system is not live on this realm yet, so the
 *               armory shows what the stock database does know, and says so.
 */
export type BuildMode = "classless" | "interim";

export interface CharacterBuild {
  mode: BuildMode;
  pointsSpent: number;
  pointsTotal: number | null;
  trees: BuildTree[];
  archetype: Archetype;
  /** Interim mode only. */
  talentsRecorded: number | null;
  abilitiesKnown: number | null;
  note: string | null;
}

export interface CharacterProfile extends CharacterSummary {
  zone: number;
  totalKills: number;
  honorPoints: number;
  achievements: number | null;
  stats: CharacterStats | null;
  gear: EquippedItem[];
  build: CharacterBuild;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  /** Absent for guild rows. */
  guid: number | null;
  level: number | null;
  chassis: number | null;
  race: number | null;
  faction: Faction;
  value: number;
  display: string;
  sub: string | null;
}

export interface Leaderboard {
  key: string;
  title: string;
  blurb: string;
  entries: LeaderboardEntry[];
  /** Set when this board cannot be built on the current database. */
  unavailable: string | null;
}
