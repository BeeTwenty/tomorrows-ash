/**
 * Static 3.3.5a reference data.
 *
 * These IDs come from the client's DBC files, which the website has no access
 * to - the realm reads them from disk, and shipping a copy here would mean
 * redistributing Blizzard data. So the handful of small, stable tables the
 * armory needs are transcribed instead, and every lookup falls back to a plain
 * "#id" rather than inventing a name.
 */

export type Faction = "alliance" | "horde" | "neutral";

export interface RaceInfo {
  name: string;
  faction: Faction;
}

export const RACES: Record<number, RaceInfo> = {
  1: { name: "Human", faction: "alliance" },
  2: { name: "Orc", faction: "horde" },
  3: { name: "Dwarf", faction: "alliance" },
  4: { name: "Night Elf", faction: "alliance" },
  5: { name: "Undead", faction: "horde" },
  6: { name: "Tauren", faction: "horde" },
  7: { name: "Gnome", faction: "alliance" },
  8: { name: "Troll", faction: "horde" },
  10: { name: "Blood Elf", faction: "horde" },
  11: { name: "Draenei", faction: "alliance" },
};

/**
 * On Ashmorrow a class is a **chassis**: the body a character is built on.
 * It still supplies base stats, armour proficiency and scaling coefficients
 * (see docs/ARCHITECTURE.md §6), but it no longer decides what you can learn.
 */
export const CHASSIS: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
};

/** A one-line description of what each chassis actually gives you. */
export const CHASSIS_TRAITS: Record<number, string> = {
  1: "Heavy frame. High health and armour, no mana pool.",
  2: "Heavy frame with mana. Plate-capable and self-sustaining.",
  3: "Agile frame. Ranged scaling and a pet slot.",
  4: "Light frame. Energy-driven, highest base dodge.",
  5: "Fragile frame. Deep mana pool and spirit regeneration.",
  6: "Heavy frame. Runic resource, starts at level 55.",
  7: "Balanced frame. Mail-capable with mana and totems.",
  8: "Fragile frame. Strongest spell scaling per point of Intellect.",
  9: "Fragile frame with a pet slot and health-for-power trades.",
  11: "Adaptive frame. Shapeshift forms change armour and resource.",
};

export function raceName(id: number): string {
  return RACES[id]?.name ?? `Race #${id}`;
}

export function chassisName(id: number): string {
  return CHASSIS[id] ?? `Chassis #${id}`;
}

export function factionOf(raceId: number): Faction {
  return RACES[raceId]?.faction ?? "neutral";
}

export function genderName(id: number): string {
  return id === 1 ? "Female" : "Male";
}

export const ITEM_QUALITY: Record<number, { name: string; colour: string }> = {
  0: { name: "Poor", colour: "#9d9d9d" },
  1: { name: "Common", colour: "#ffffff" },
  2: { name: "Uncommon", colour: "#1eff00" },
  3: { name: "Rare", colour: "#0070dd" },
  4: { name: "Epic", colour: "#a335ee" },
  5: { name: "Legendary", colour: "#ff8000" },
  6: { name: "Artifact", colour: "#e6cc80" },
  7: { name: "Heirloom", colour: "#00ccff" },
};

export function qualityColour(quality: number): string {
  return ITEM_QUALITY[quality]?.colour ?? "#ffffff";
}

/** character_inventory.slot values for equipped gear (bag = 0). */
export const EQUIPMENT_SLOTS: Array<{ slot: number; label: string }> = [
  { slot: 0, label: "Head" },
  { slot: 1, label: "Neck" },
  { slot: 2, label: "Shoulders" },
  { slot: 14, label: "Back" },
  { slot: 4, label: "Chest" },
  { slot: 3, label: "Shirt" },
  { slot: 18, label: "Tabard" },
  { slot: 8, label: "Wrists" },
  { slot: 9, label: "Hands" },
  { slot: 5, label: "Waist" },
  { slot: 6, label: "Legs" },
  { slot: 7, label: "Feet" },
  { slot: 10, label: "Ring" },
  { slot: 11, label: "Ring" },
  { slot: 12, label: "Trinket" },
  { slot: 13, label: "Trinket" },
  { slot: 15, label: "Main hand" },
  { slot: 16, label: "Off hand" },
  { slot: 17, label: "Ranged" },
];

export const EQUIPMENT_SLOT_LABELS: Record<number, string> = Object.fromEntries(
  EQUIPMENT_SLOTS.map(({ slot, label }) => [slot, label]),
);

/** characters.power1..7, in table order. */
export const POWER_NAMES = ["Mana", "Rage", "Focus", "Energy", "Happiness", "Runes", "Runic Power"] as const;

/**
 * Major zones. Deliberately partial - instances, micro-zones and anything
 * uncertain fall through to "Zone #id" instead of being guessed at.
 */
export const ZONES: Record<number, string> = {
  1: "Dun Morogh",
  3: "Badlands",
  4: "Blasted Lands",
  8: "Swamp of Sorrows",
  10: "Duskwood",
  11: "Wetlands",
  12: "Elwynn Forest",
  14: "Durotar",
  15: "Dustwallow Marsh",
  16: "Azshara",
  17: "The Barrens",
  28: "Western Plaguelands",
  33: "Stranglethorn Vale",
  36: "Alterac Mountains",
  38: "Loch Modan",
  40: "Westfall",
  41: "Deadwind Pass",
  44: "Redridge Mountains",
  45: "Arathi Highlands",
  46: "Burning Steppes",
  47: "The Hinterlands",
  51: "Searing Gorge",
  65: "Dragonblight",
  66: "Zul'Drak",
  67: "The Storm Peaks",
  85: "Tirisfal Glades",
  130: "Silverpine Forest",
  139: "Eastern Plaguelands",
  141: "Teldrassil",
  148: "Darkshore",
  210: "Icecrown",
  215: "Mulgore",
  267: "Hillsbrad Foothills",
  331: "Ashenvale",
  357: "Feralas",
  361: "Felwood",
  394: "Grizzly Hills",
  400: "Thousand Needles",
  405: "Desolace",
  406: "Stonetalon Mountains",
  440: "Tanaris",
  490: "Un'Goro Crater",
  493: "Moonglade",
  495: "Howling Fjord",
  618: "Winterspring",
  1377: "Silithus",
  1497: "Undercity",
  1519: "Stormwind City",
  1537: "Ironforge",
  1637: "Orgrimmar",
  1638: "Thunder Bluff",
  1657: "Darnassus",
  3430: "Eversong Woods",
  3433: "Ghostlands",
  3483: "Hellfire Peninsula",
  3487: "Silvermoon City",
  3518: "Nagrand",
  3519: "Terokkar Forest",
  3520: "Shadowmoon Valley",
  3521: "Zangarmarsh",
  3522: "Blade's Edge Mountains",
  3523: "Netherstorm",
  3524: "Azuremyst Isle",
  3525: "Bloodmyst Isle",
  3537: "Borean Tundra",
  3557: "The Exodar",
  3703: "Shattrath City",
  3711: "Sholazar Basin",
  4080: "Isle of Quel'Danas",
  4197: "Wintergrasp",
  4395: "Dalaran",
};

export function zoneName(id: number): string {
  return ZONES[id] ?? `Zone #${id}`;
}

export const MAX_LEVEL = 80;
