/**
 * Naming a build that has no class.
 *
 * A normal armory can print "Fire Mage" because the class and spec are facts
 * the server stores. Ashmorrow has neither. What it has is a distribution of
 * skill points across ability trees, so the character's identity has to be
 * *derived* from the shape of that spending.
 *
 * The rules below are intentionally simple and deterministic - two characters
 * with the same spread always get the same title, and the title is a summary a
 * player can argue with, never a mechanical effect.
 *
 * Every tree name the lexicon does not recognise still gets a sensible title,
 * because the real tree list does not exist yet (see docs/ROADMAP.md, Phase 2)
 * and must be free to change without touching this file.
 */

export interface TreeWeight {
  /** Display name of the tree, e.g. "Fire" or "Sword Mastery". */
  name: string;
  points: number;
}

export type BuildShape = "unspent" | "focused" | "paired" | "broad";

export interface Archetype {
  title: string;
  /** The trees behind the title, e.g. "Fire · Sword Mastery". */
  descriptor: string;
  shape: BuildShape;
  summary: string;
}

interface LexiconEntry {
  /** Leading half of a compound title: Ember + blade. */
  prefix: string;
  /** Trailing half of a compound title: Steel + flame. */
  suffix: string;
  /** Title for a build that pours almost everything into this one tree. */
  solo: string;
}

/**
 * Matched against the lowercased tree name, longest key first, so
 * "Shadow Weaving" matches `shadow` and "Sword Mastery" matches `sword`.
 */
const LEXICON: Record<string, LexiconEntry> = {
  fire: { prefix: "Ember", suffix: "flame", solo: "Pyresworn" },
  flame: { prefix: "Ember", suffix: "flame", solo: "Pyresworn" },
  frost: { prefix: "Rime", suffix: "frost", solo: "Frostbound" },
  ice: { prefix: "Rime", suffix: "frost", solo: "Frostbound" },
  arcane: { prefix: "Aether", suffix: "sigil", solo: "Aethermarked" },
  shadow: { prefix: "Umbral", suffix: "shade", solo: "Shadeborn" },
  holy: { prefix: "Gilded", suffix: "light", solo: "Lightkept" },
  light: { prefix: "Gilded", suffix: "light", solo: "Lightkept" },
  nature: { prefix: "Verdant", suffix: "root", solo: "Rootbound" },
  blood: { prefix: "Blood", suffix: "blood", solo: "Bloodsworn" },
  ash: { prefix: "Ash", suffix: "ash", solo: "Ashbound" },
  sword: { prefix: "Steel", suffix: "blade", solo: "Bladebearer" },
  blade: { prefix: "Steel", suffix: "blade", solo: "Bladebearer" },
  axe: { prefix: "Cleaving", suffix: "axe", solo: "Axebearer" },
  mace: { prefix: "Iron", suffix: "hammer", solo: "Hammerhand" },
  hammer: { prefix: "Iron", suffix: "hammer", solo: "Hammerhand" },
  fist: { prefix: "Iron", suffix: "fist", solo: "Fistbound" },
  dagger: { prefix: "Quiet", suffix: "fang", solo: "Knifehand" },
  stealth: { prefix: "Quiet", suffix: "step", solo: "The Unseen" },
  shadowstep: { prefix: "Quiet", suffix: "step", solo: "The Unseen" },
  poison: { prefix: "Venom", suffix: "fang", solo: "Venomtouched" },
  bow: { prefix: "Far", suffix: "shot", solo: "Longsight" },
  ranged: { prefix: "Far", suffix: "shot", solo: "Longsight" },
  marksman: { prefix: "Far", suffix: "shot", solo: "Longsight" },
  shield: { prefix: "Bulwark", suffix: "ward", solo: "Shieldsworn" },
  defen: { prefix: "Bulwark", suffix: "ward", solo: "Warden" },
  protect: { prefix: "Bulwark", suffix: "ward", solo: "Warden" },
  armor: { prefix: "Plated", suffix: "ward", solo: "Warden" },
  armour: { prefix: "Plated", suffix: "ward", solo: "Warden" },
  heal: { prefix: "Mending", suffix: "mend", solo: "Mender" },
  restor: { prefix: "Mending", suffix: "mend", solo: "Mender" },
  mend: { prefix: "Mending", suffix: "mend", solo: "Mender" },
  beast: { prefix: "Beast", suffix: "call", solo: "Beastcaller" },
  pet: { prefix: "Beast", suffix: "call", solo: "Beastcaller" },
  summon: { prefix: "Binding", suffix: "call", solo: "Summoner" },
  demon: { prefix: "Binding", suffix: "pact", solo: "Pactbound" },
  rage: { prefix: "Raging", suffix: "fury", solo: "Furyborn" },
  fury: { prefix: "Raging", suffix: "fury", solo: "Furyborn" },
  totem: { prefix: "Standing", suffix: "totem", solo: "Totembearer" },
  storm: { prefix: "Storm", suffix: "storm", solo: "Stormcalled" },
  lightning: { prefix: "Storm", suffix: "storm", solo: "Stormcalled" },
};

const LEXICON_KEYS = Object.keys(LEXICON).sort((a, b) => b.length - a.length);

function lookup(treeName: string): LexiconEntry | null {
  const haystack = treeName.toLowerCase();
  for (const key of LEXICON_KEYS) {
    if (haystack.includes(key)) return LEXICON[key]!;
  }
  return null;
}

/** Chosen so a build that is 2 points into a third tree still reads as "paired". */
const FOCUSED_SHARE = 0.65;
const PAIRED_SHARE = 0.8;
const PAIRED_MINOR_SHARE = 0.15;

export function composeArchetype(weights: TreeWeight[]): Archetype {
  const spent = weights.filter((w) => w.points > 0).sort((a, b) => b.points - a.points);
  const total = spent.reduce((sum, w) => sum + w.points, 0);

  if (total === 0) {
    return {
      title: "Unkindled",
      descriptor: "Nothing spent",
      shape: "unspent",
      summary: "No points committed. Every road is still open.",
    };
  }

  const primary = spent[0]!;
  const secondary = spent[1];
  const primaryShare = primary.points / total;
  const secondaryShare = secondary ? secondary.points / total : 0;

  if (primaryShare >= FOCUSED_SHARE) {
    const entry = lookup(primary.name);
    return {
      title: entry ? entry.solo : `${primary.name}-sworn`,
      descriptor: primary.name,
      shape: "focused",
      summary: `${Math.round(primaryShare * 100)}% of every point poured into ${primary.name}.`,
    };
  }

  if (secondary && primaryShare + secondaryShare >= PAIRED_SHARE && secondaryShare >= PAIRED_MINOR_SHARE) {
    const primaryEntry = lookup(primary.name);
    const secondaryEntry = lookup(secondary.name);
    const title =
      primaryEntry && secondaryEntry
        ? `${primaryEntry.prefix}${secondaryEntry.suffix}`
        : "Twinbrand";
    return {
      title,
      descriptor: `${primary.name} · ${secondary.name}`,
      shape: "paired",
      summary: `Two trees carry this build: ${primary.points} in ${primary.name}, ${secondary.points} in ${secondary.name}.`,
    };
  }

  const named = spent.slice(0, 3).map((w) => w.name);
  return {
    title: "Cinderwake",
    descriptor: named.join(" · "),
    shape: "broad",
    summary: `Points spread across ${spent.length} trees. Nothing dominates.`,
  };
}
