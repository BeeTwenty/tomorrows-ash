import type { RowDataPacket } from "mysql2";
import { columnsOf, schema, tableExists, tablesExist, tryQuery } from "./db";
import { env } from "./env";
import { composeArchetype } from "./archetype";
import type { BuildNode, BuildTree, CharacterBuild } from "./types";

/**
 * Reading a character's build on a realm with no classes.
 *
 * The tables this reads are the module's own, created by
 * modules/mod-classless/data/sql:
 *
 *   world   classless_tree            id, name, description, sort_order, enabled
 *   world   classless_node            id, tree_id, spell_id, name, description,
 *                                     tier, cost, required_level, requires_node,
 *                                     sort_order, enabled
 *   chars   classless_character_node  guid, node_id, spell_id, learned_at
 *
 * Two of those shapes will move under it, so nothing here assumes them:
 *
 *   - **Ranks.** Phase 1 buys a node once; there is no `rank` column. If Phase 2
 *     adds one, the column probe below picks it up and the display switches
 *     from "bought" to ranked pips without another change here.
 *   - **A budget.** `classless_character` (points_total / points_spent) is a
 *     Phase 2 table. Without it the spend bar simply has no unspent remainder.
 *
 * And when none of the tables exist at all - a realm that has not applied the
 * module SQL - `loadBuild` returns an **interim** build: the chassis, what the
 * stock database records, and a plain statement that the system is not live
 * here. It never invents a tree that does not exist.
 */

const CLASSLESS_WORLD_TABLES = ["classless_tree", "classless_node"];
const CLASSLESS_CHAR_TABLES = ["classless_character_node"];

/**
 * Tree colours. Warm first - the palette is the site's, not Blizzard's - with
 * cool tones held back for the trees that need to read as different at a
 * glance. Assigned by position so a build's colours never shift between loads.
 */
const TREE_COLOURS = [
  "#ff6a1f",
  "#e0b062",
  "#c2410c",
  "#7fa8b5",
  "#9b8ec4",
  "#6f9e7a",
  "#c96f8f",
  "#8a8378",
];

export function treeColour(index: number): string {
  return TREE_COLOURS[index % TREE_COLOURS.length]!;
}

interface TreeRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
}

interface NodeRow extends RowDataPacket {
  id: number;
  tree_id: number;
  spell_id: number;
  tier: number;
  cost: number;
  name: string | null;
  max_rank: number | null;
  description: string | null;
}

interface CharNodeRow extends RowDataPacket {
  node_id: number;
  rank: number;
  cost_paid: number | null;
  granted: number;
}

interface BudgetRow extends RowDataPacket {
  points_total: number;
  points_spent: number;
}

interface CountRow extends RowDataPacket {
  n: number;
}

export async function classlessTablesPresent(): Promise<boolean> {
  const [world, chars] = await Promise.all([
    tablesExist(env.db.world, CLASSLESS_WORLD_TABLES),
    tablesExist(env.db.characters, CLASSLESS_CHAR_TABLES),
  ]);
  return world && chars;
}

const INTERIM_NOTE =
  "The classless system is not live on this realm yet, so there are no ability trees to show. " +
  "This is what the realm database records today.";

async function interimBuild(guid: number): Promise<CharacterBuild> {
  const [talents, spells] = await Promise.all([
    tryQuery<CountRow>(
      "interim talents",
      `SELECT COUNT(*) AS n FROM ${schema.chars}.\`character_talent\` WHERE guid = ?`,
      [guid],
    ),
    tryQuery<CountRow>(
      "interim spells",
      `SELECT COUNT(*) AS n FROM ${schema.chars}.\`character_spell\` WHERE guid = ?`,
      [guid],
    ),
  ]);

  return {
    mode: "interim",
    pointsSpent: 0,
    pointsTotal: null,
    trees: [],
    archetype: composeArchetype([]),
    talentsRecorded: talents?.[0]?.n ?? null,
    abilitiesKnown: spells?.[0]?.n ?? null,
    note: INTERIM_NOTE,
  };
}

export interface BudgetCurve {
  firstLevel: number;
  perLevel: number;
  bonus: number;
}

/**
 * `ClasslessConfig::BudgetForLevel`, given a curve.
 *
 *   level < FirstLevel ? Bonus : (level - FirstLevel + 1) * PerLevel + Bonus
 */
export function budgetForLevel(level: number, curve: BudgetCurve): number {
  if (level < curve.firstLevel) return curve.bonus;
  return (level - curve.firstLevel + 1) * curve.perLevel + curve.bonus;
}

interface CurveRow extends RowDataPacket {
  points_first_level: number;
  points_per_level: number;
  points_bonus: number;
}

/**
 * Where the budget curve comes from, in order of trustworthiness.
 *
 *   1. A curve the module publishes to the database. Authoritative, cannot go
 *      stale, and does not exist yet - docs/PHASE2-BUDGET.md §5 proposes it.
 *      Probed for so that building it needs no change here.
 *   2. CLASSLESS_POINTS_* in this service's environment. A second copy of the
 *      server's config: correct until someone re-tunes the realm and not here.
 *      Opt-in, never assumed.
 *   3. Nothing. The armory shows points spent with no denominator, which is
 *      always true.
 *
 * Spend itself never comes from here - it is summed from `cost_paid`, which
 * the database holds exactly.
 */
async function resolveBudgetCurve(): Promise<BudgetCurve | null> {
  if (await tableExists(env.db.world, "classless_config")) {
    const rows = await tryQuery<CurveRow>(
      "classless budget curve",
      `SELECT points_first_level, points_per_level, points_bonus
         FROM ${schema.world}.\`classless_config\` LIMIT 1`,
    );
    const row = rows?.[0];
    if (row) {
      return {
        firstLevel: row.points_first_level,
        perLevel: row.points_per_level,
        bonus: row.points_bonus,
      };
    }
  }

  const { pointsPerLevel, pointsFirstLevel, pointsBonus } = env.classless;
  if (pointsPerLevel === null) return null;
  return { firstLevel: pointsFirstLevel, perLevel: pointsPerLevel, bonus: pointsBonus };
}

export async function loadBuild(guid: number, level?: number): Promise<CharacterBuild> {
  if (!(await classlessTablesPresent())) return interimBuild(guid);

  // Phase 1 has `name` but no `max_rank`; a character node is bought, not
  // ranked. Ask the database which of those exist rather than assuming, so a
  // Phase 2 migration lights up the richer display on its own.
  const [nodeColumns, charNodeColumns] = await Promise.all([
    columnsOf(env.db.world, "classless_node"),
    columnsOf(env.db.characters, "classless_character_node"),
  ]);

  const nameExpr = nodeColumns.has("name") ? "n.`name`" : "NULL";
  const maxRankExpr = nodeColumns.has("max_rank") ? "n.`max_rank`" : "NULL";
  const descriptionExpr = nodeColumns.has("description") ? "n.`description`" : "NULL";
  const enabledFilter = nodeColumns.has("enabled") ? "WHERE n.`enabled` = 1" : "";
  const treeOrder = (await columnsOf(env.db.world, "classless_tree")).has("sort_order")
    ? "sort_order, id"
    : "id";
  // `rank` became reserved in MySQL 8; it has to stay quoted where it exists.
  const rankExpr = charNodeColumns.has("rank") ? "`rank`" : "1 AS `rank`";
  // Phase 2 records what a character was actually charged. Using it rather than
  // the node's current cost means re-pricing a node does not retroactively
  // rewrite what everyone who bought it earlier appears to have paid.
  const costPaidExpr = charNodeColumns.has("cost_paid") ? "`cost_paid`" : "NULL AS `cost_paid`";
  // `granted = 0` means the character already knew that spell and it was never
  // sold to them (docs/PHASE2-BUDGET.md §2). Worth showing: it is the
  // difference between a choice they paid for and one their chassis came with.
  const grantedExpr = charNodeColumns.has("granted") ? "`granted`" : "1 AS `granted`";

  const [trees, nodes, taken, budget] = await Promise.all([
    tryQuery<TreeRow>(
      "classless trees",
      `SELECT id, name, description
         FROM ${schema.world}.\`classless_tree\`
        ORDER BY ${treeOrder}`,
    ),
    tryQuery<NodeRow>(
      "classless nodes",
      `SELECT n.id, n.tree_id, n.spell_id, n.tier, n.cost,
              ${nameExpr} AS name, ${maxRankExpr} AS max_rank,
              ${descriptionExpr} AS description
         FROM ${schema.world}.\`classless_node\` n
         ${enabledFilter}`,
    ),
    tryQuery<CharNodeRow>(
      "classless character nodes",
      `SELECT node_id, ${rankExpr}, ${costPaidExpr}, ${grantedExpr}
         FROM ${schema.chars}.\`classless_character_node\`
        WHERE guid = ?`,
      [guid],
    ),
    // `classless_character` was considered and rejected - spend is a cheap
    // join, and a materialised row would be a second source of truth
    // (docs/PHASE2-BUDGET.md §5). It is still probed for rather than assumed
    // absent, but only queried when it exists: querying a table the project has
    // decided not to build would log an error on every profile view.
    (async () =>
      (await tableExists(env.db.characters, "classless_character"))
        ? tryQuery<BudgetRow>(
            "classless budget",
            `SELECT points_total, points_spent FROM ${schema.chars}.\`classless_character\` WHERE guid = ?`,
            [guid],
          )
        : null)(),
  ]);

  if (!trees || !nodes || !taken) return interimBuild(guid);

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const treesById = new Map<number, BuildTree>();

  trees.forEach((row, index) => {
    treesById.set(row.id, {
      id: row.id,
      name: row.name,
      description: row.description,
      points: 0,
      share: 0,
      colour: treeColour(index),
      nodes: [],
    });
  });

  let pointsSpent = 0;

  for (const row of taken) {
    const node = nodesById.get(row.node_id);
    if (!node) continue;
    const tree = treesById.get(node.tree_id);
    if (!tree) continue;

    // Without ranks every purchased node counts once, which is what the
    // `1 AS rank` fallback above produces.
    const rank = Math.max(1, row.rank);
    const spent =
      row.cost_paid !== null ? Math.max(0, row.cost_paid) : rank * Math.max(0, node.cost);
    const built: BuildNode = {
      id: node.id,
      name: node.name ?? `Ability #${node.spell_id}`,
      description: node.description,
      spellId: node.spell_id,
      tier: node.tier,
      rank,
      maxRank: node.max_rank,
      pointsSpent: spent,
      granted: row.granted !== 0,
    };
    tree.nodes.push(built);
    tree.points += spent;
    pointsSpent += spent;
  }

  // The denominator is optional; the numerator above never is.
  const curve = level !== undefined ? await resolveBudgetCurve() : null;
  const totalPoints =
    budget?.[0]?.points_total ?? (curve && level !== undefined ? budgetForLevel(level, curve) : null);

  const populated = [...treesById.values()]
    .filter((tree) => tree.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  for (const tree of populated) {
    tree.share = pointsSpent > 0 ? tree.points / pointsSpent : 0;
    tree.nodes.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }

  return {
    mode: "classless",
    // The itemised sum. It is what the tree list below it actually justifies,
    // and with `cost_paid` present it is also what the realm charged.
    pointsSpent,
    pointsTotal: totalPoints,
    trees: populated,
    archetype: composeArchetype(populated.map((t) => ({ name: t.name, points: t.points }))),
    talentsRecorded: null,
    abilitiesKnown: null,
    note: null,
  };
}
