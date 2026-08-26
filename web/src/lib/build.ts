import type { RowDataPacket } from "mysql2";
import { columnsOf, schema, tablesExist, tryQuery } from "./db";
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

/**
 * The point budget a character of this level is entitled to.
 *
 * Mirrors `ClasslessConfig::BudgetForLevel` in the module:
 *
 *   level < FirstLevel ? Bonus : (level - FirstLevel + 1) * PerLevel + Bonus
 *
 * The module derives this from level and never stores it, so there is no table
 * to read - the site has to compute the same curve. That means the three
 * settings in `web/.env.local` must match `mod_classless.conf`; if they drift,
 * the armory's "of N" is wrong while everything else stays right. Hence the
 * loud comment in .env.example rather than a silent default.
 */
export function budgetForLevel(level: number): number {
  const { pointsFirstLevel, pointsPerLevel, pointsBonus } = env.classless;
  if (level < pointsFirstLevel) return pointsBonus;
  return (level - pointsFirstLevel + 1) * pointsPerLevel + pointsBonus;
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
      `SELECT node_id, ${rankExpr}, ${costPaidExpr}
         FROM ${schema.chars}.\`classless_character_node\`
        WHERE guid = ?`,
      [guid],
    ),
    tryQuery<BudgetRow>(
      "classless budget",
      `SELECT points_total, points_spent FROM ${schema.chars}.\`classless_character\` WHERE guid = ?`,
      [guid],
    ),
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
    };
    tree.nodes.push(built);
    tree.points += spent;
    pointsSpent += spent;
  }

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
    pointsTotal:
      budget?.[0]?.points_total ?? (level !== undefined ? budgetForLevel(level) : null),
    trees: populated,
    archetype: composeArchetype(populated.map((t) => ({ name: t.name, points: t.points }))),
    talentsRecorded: null,
    abilitiesKnown: null,
    note: null,
  };
}
