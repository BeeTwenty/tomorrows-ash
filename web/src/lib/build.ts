import type { RowDataPacket } from "mysql2";
import { columnsOf, schema, tablesExist, tryQuery } from "./db";
import { env } from "./env";
import { composeArchetype } from "./archetype";
import type { BuildNode, BuildTree, CharacterBuild } from "./types";

/**
 * Reading a character's build on a realm with no classes.
 *
 * The data contract this expects is the Phase 2 schema sketched in
 * docs/ARCHITECTURE.md §5:
 *
 *   world   classless_tree            id, name, description
 *   world   classless_node            id, tree_id, spell_id, tier, cost
 *                                     (optional: name, max_rank, icon)
 *   chars   classless_character       guid, points_total, points_spent
 *   chars   classless_character_node  guid, node_id, rank
 *
 * None of it exists yet. Until it does, `loadBuild` returns an **interim**
 * build: the chassis, the talents and abilities the stock database records,
 * and a plain statement that the classless system is not live here. It never
 * invents a tree that does not exist.
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
}

interface CharNodeRow extends RowDataPacket {
  node_id: number;
  rank: number;
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

export async function loadBuild(guid: number): Promise<CharacterBuild> {
  if (!(await classlessTablesPresent())) return interimBuild(guid);

  // `name` and `max_rank` are recommended additions to classless_node, not
  // part of the sketch. Select them only when the realm actually has them.
  const nodeColumns = await columnsOf(env.db.world, "classless_node");
  const nameExpr = nodeColumns.has("name") ? "n.`name`" : "NULL";
  const maxRankExpr = nodeColumns.has("max_rank") ? "n.`max_rank`" : "NULL";

  const [trees, nodes, taken, budget] = await Promise.all([
    tryQuery<TreeRow>(
      "classless trees",
      `SELECT id, name, description FROM ${schema.world}.\`classless_tree\` ORDER BY id`,
    ),
    tryQuery<NodeRow>(
      "classless nodes",
      `SELECT n.id, n.tree_id, n.spell_id, n.tier, n.cost,
              ${nameExpr} AS name, ${maxRankExpr} AS max_rank
         FROM ${schema.world}.\`classless_node\` n`,
    ),
    tryQuery<CharNodeRow>(
      "classless character nodes",
      // `rank` became reserved in MySQL 8; it has to stay quoted.
      `SELECT node_id, \`rank\` FROM ${schema.chars}.\`classless_character_node\` WHERE guid = ?`,
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

    const rank = Math.max(0, row.rank);
    const spent = rank * Math.max(0, node.cost);
    const built: BuildNode = {
      id: node.id,
      name: node.name ?? `Ability #${node.spell_id}`,
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
    // The itemised sum, not `classless_character.points_spent`. The two should
    // agree; when they do not, the number shown is the one the tree list below
    // it actually justifies.
    pointsSpent,
    pointsTotal: budget?.[0]?.points_total ?? null,
    trees: populated,
    archetype: composeArchetype(populated.map((t) => ({ name: t.name, points: t.points }))),
    talentsRecorded: null,
    abilitiesKnown: null,
    note: null,
  };
}
