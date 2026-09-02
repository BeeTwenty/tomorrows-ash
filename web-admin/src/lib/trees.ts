import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne, schema, tableExists, transaction, type SqlParam } from "./db";
import { env } from "./env";
import { trySoap, type SoapAttempt } from "./soap";

/**
 * The classless ability trees.
 *
 * Two contracts from CLAUDE.md §6 and §9 are load-bearing here and are the
 * reason this file exists rather than importing the public site's build.ts:
 *
 *   - **There are no ranks.** A node is bought once. Nothing has a `rank` or
 *     `max_rank` column, and a query that assumes one fails - which is exactly
 *     what happened to the armory, silently, until the error was traced.
 *   - **Spend is `cost_paid`, not `classless_node.cost`.** The price paid at
 *     purchase time, so re-pricing a node applies to new purchases only. A
 *     panel that lets an administrator change prices makes that distinction
 *     immediately consequential.
 *
 * The schema is probed rather than assumed, for the same reason: this app must
 * render honestly on a realm that has not run the module's migrations yet, and
 * say "not live" rather than invent a tree.
 */

export interface TreeRow {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  nodeCount: number;
}

export interface NodeRow {
  id: number;
  treeId: number;
  treeName: string;
  spellId: number;
  name: string;
  description: string;
  tier: number;
  cost: number;
  requiredLevel: number;
  requiresNode: number;
  sortOrder: number;
  enabled: boolean;
  purchases: number;
}

export async function classlessLive(): Promise<boolean> {
  const [tree, node] = await Promise.all([
    tableExists(env.db.world, "classless_tree"),
    tableExists(env.db.world, "classless_node"),
  ]);
  return tree && node;
}

export async function listTrees(): Promise<TreeRow[]> {
  if (!(await classlessLive())) return [];

  const rows = await query<RowDataPacket & {
    id: number;
    name: string;
    description: string;
    sort_order: number;
    enabled: number;
    node_count: number;
  }>(
    `SELECT t.id, t.name, t.description, t.sort_order, t.enabled,
            (SELECT COUNT(*) FROM ${schema.world}.\`classless_node\` n WHERE n.tree_id = t.id) AS node_count
       FROM ${schema.world}.\`classless_tree\` t
      ORDER BY t.sort_order, t.name`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    enabled: row.enabled > 0,
    nodeCount: Number(row.node_count ?? 0),
  }));
}

export async function listNodes(treeId?: number): Promise<NodeRow[]> {
  if (!(await classlessLive())) return [];

  const params: SqlParam[] = [];
  let clause = "";
  if (treeId !== undefined) {
    clause = "WHERE n.tree_id = ?";
    params.push(treeId);
  }

  const purchasesJoin = (await tableExists(env.db.characters, "classless_character_node"))
    ? `(SELECT COUNT(*) FROM ${schema.chars}.\`classless_character_node\` cn WHERE cn.node_id = n.id)`
    : "0";

  const rows = await query<RowDataPacket & {
    id: number;
    tree_id: number;
    tree_name: string;
    spell_id: number;
    name: string;
    description: string;
    tier: number;
    cost: number;
    required_level: number;
    requires_node: number;
    sort_order: number;
    enabled: number;
    purchases: number;
  }>(
    `SELECT n.id, n.tree_id, t.name AS tree_name, n.spell_id, n.name, n.description,
            n.tier, n.cost, n.required_level, n.requires_node, n.sort_order, n.enabled,
            ${purchasesJoin} AS purchases
       FROM ${schema.world}.\`classless_node\` n
       LEFT JOIN ${schema.world}.\`classless_tree\` t ON t.id = n.tree_id
       ${clause}
      ORDER BY n.tree_id, n.tier, n.sort_order, n.name`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    treeId: row.tree_id,
    treeName: row.tree_name ?? "—",
    spellId: row.spell_id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    cost: row.cost,
    requiredLevel: row.required_level,
    requiresNode: row.requires_node,
    sortOrder: row.sort_order,
    enabled: row.enabled > 0,
    purchases: Number(row.purchases ?? 0),
  }));
}

export async function getNode(id: number): Promise<NodeRow | null> {
  const nodes = await listNodes();
  return nodes.find((node) => node.id === id) ?? null;
}

/**
 * Change a node's tunables.
 *
 * `spell_id` is deliberately not editable from here. `tools/gen_trees.py`
 * refuses to emit a node whose spell cannot be proven to exist via
 * `trainer_spell` or `spell_ranks`, and this panel has no way to run that
 * check - a node pointing at a spell that does not exist takes a player's
 * points and gives them nothing. Repointing a node is a repository change,
 * reviewed, not a form field.
 */
export interface NodeEdit {
  name?: string;
  description?: string;
  cost?: number;
  requiredLevel?: number;
  tier?: number;
  sortOrder?: number;
  enabled?: boolean;
}

export async function editNode(id: number, edit: NodeEdit): Promise<void> {
  const sets: string[] = [];
  const params: SqlParam[] = [];

  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (!name || name.length > 64) throw new Error("A node name must be 1-64 characters.");
    sets.push("name = ?");
    params.push(name);
  }
  if (edit.description !== undefined) {
    sets.push("description = ?");
    params.push(edit.description.trim().slice(0, 255));
  }
  if (edit.cost !== undefined) {
    if (!Number.isInteger(edit.cost) || edit.cost < 0 || edit.cost > 1000) {
      throw new Error("A cost must be between 0 and 1000 points.");
    }
    sets.push("cost = ?");
    params.push(edit.cost);
  }
  if (edit.requiredLevel !== undefined) {
    if (!Number.isInteger(edit.requiredLevel) || edit.requiredLevel < 1 || edit.requiredLevel > 80) {
      throw new Error("A required level must be between 1 and 80.");
    }
    sets.push("required_level = ?");
    params.push(edit.requiredLevel);
  }
  if (edit.tier !== undefined) {
    if (!Number.isInteger(edit.tier) || edit.tier < 1 || edit.tier > 20) throw new Error("A tier must be 1-20.");
    sets.push("tier = ?");
    params.push(edit.tier);
  }
  if (edit.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    params.push(Math.trunc(edit.sortOrder));
  }
  if (edit.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(edit.enabled ? 1 : 0);
  }

  if (sets.length === 0) throw new Error("Nothing to change.");

  params.push(id);
  await execute(`UPDATE ${schema.world}.\`classless_node\` SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function editTree(
  id: number,
  edit: { name?: string; description?: string; sortOrder?: number; enabled?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const params: SqlParam[] = [];

  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (!name || name.length > 64) throw new Error("A tree name must be 1-64 characters.");
    sets.push("name = ?");
    params.push(name);
  }
  if (edit.description !== undefined) {
    sets.push("description = ?");
    params.push(edit.description.trim().slice(0, 255));
  }
  if (edit.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    params.push(Math.trunc(edit.sortOrder));
  }
  if (edit.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(edit.enabled ? 1 : 0);
  }

  if (sets.length === 0) throw new Error("Nothing to change.");

  params.push(id);
  await execute(`UPDATE ${schema.world}.\`classless_tree\` SET ${sets.join(", ")} WHERE id = ?`, params);
}

/**
 * Make the running server pick up an edit.
 *
 * The module caches trees at load. Without a reload the change is true in the
 * database and false in the world, which is the single most confusing state
 * this page can leave behind - so the reload is offered next to every edit and
 * its outcome reported, never assumed.
 */
export async function reloadTrees(): Promise<SoapAttempt> {
  return trySoap("classless reload");
}

/* ------------------------------------------------------------------ *
 * A character's purchases
 * ------------------------------------------------------------------ */

export interface Purchase {
  nodeId: number;
  nodeName: string;
  treeName: string;
  spellId: number;
  costPaid: number;
  granted: boolean;
  learnedAt: Date | null;
}

export interface CharacterBuild {
  live: boolean;
  purchases: Purchase[];
  spent: number;
  budget: number | null;
  budgetSource: string | null;
}

/**
 * The budget curve.
 *
 * `(level - FirstLevel + 1) * PerLevel + Bonus`, computed from level on every
 * read and never stored (docs/PHASE2-BUDGET.md §5 rejected a cache table).
 *
 * The values live in `mod_classless.conf` on the worldserver, which this panel
 * cannot read. Mirroring them in the panel's own environment would create a
 * second source of truth that silently disagrees with the first, so instead:
 * a published `classless_config` table is used when it exists, and when it does
 * not, the panel reports the spend and says the budget is unknown. That table
 * is the cross-session request in docs/decisions/0008-admin-panel.md.
 */
async function budgetFor(level: number): Promise<{ budget: number | null; source: string | null }> {
  if (!(await tableExists(env.db.world, "classless_config"))) {
    return { budget: null, source: null };
  }

  const rows = await query<RowDataPacket & { name: string; value: string }>(
    `SELECT name, value FROM ${schema.world}.\`classless_config\``,
  );
  const config = new Map(rows.map((entry) => [entry.name, Number(entry.value)]));

  const firstLevel = config.get("Points.FirstLevel");
  const perLevel = config.get("Points.PerLevel");
  const bonus = config.get("Points.Bonus") ?? 0;

  if (firstLevel === undefined || perLevel === undefined || !Number.isFinite(firstLevel) || !Number.isFinite(perLevel)) {
    return { budget: null, source: null };
  }

  const budget = level < firstLevel ? bonus : (level - firstLevel + 1) * perLevel + bonus;
  return { budget, source: "classless_config" };
}

export async function characterBuild(guid: number, level: number): Promise<CharacterBuild> {
  const hasPurchases = await tableExists(env.db.characters, "classless_character_node");
  if (!hasPurchases || !(await classlessLive())) {
    return { live: false, purchases: [], spent: 0, budget: null, budgetSource: null };
  }

  // Probed, not assumed. The armory shipped a query against a `rank` column
  // the schema never had; the error was swallowed and every character with
  // purchases rendered as having none.
  const columns = await query<RowDataPacket & { COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = ? AND table_name = 'classless_character_node'`,
    [env.db.characters],
  );
  const names = new Set(columns.map((column) => column.COLUMN_NAME));
  const costExpression = names.has("cost_paid") ? "cn.cost_paid" : "n.cost";
  const grantedExpression = names.has("granted") ? "cn.granted" : "1";

  const rows = await query<RowDataPacket & {
    node_id: number;
    node_name: string;
    tree_name: string;
    spell_id: number;
    cost_paid: number;
    granted: number;
    learned_at: Date | null;
  }>(
    `SELECT cn.node_id, n.name AS node_name, t.name AS tree_name, cn.spell_id,
            ${costExpression} AS cost_paid, ${grantedExpression} AS granted, cn.learned_at
       FROM ${schema.chars}.\`classless_character_node\` cn
       LEFT JOIN ${schema.world}.\`classless_node\` n ON n.id = cn.node_id
       LEFT JOIN ${schema.world}.\`classless_tree\` t ON t.id = n.tree_id
      WHERE cn.guid = ?
      ORDER BY t.sort_order, n.tier, n.sort_order`,
    [guid],
  );

  const purchases: Purchase[] = rows.map((row) => ({
    nodeId: row.node_id,
    nodeName: row.node_name ?? `node ${row.node_id}`,
    treeName: row.tree_name ?? "—",
    spellId: row.spell_id,
    costPaid: Number(row.cost_paid ?? 0),
    granted: Number(row.granted ?? 1) > 0,
    learnedAt: row.learned_at,
  }));

  const { budget, source } = await budgetFor(level);

  return {
    live: true,
    purchases,
    spent: purchases.reduce((total, purchase) => total + purchase.costPaid, 0),
    budget,
    budgetSource: source,
  };
}

/**
 * Refund a purchase.
 *
 * `granted = 0` means the character already knew that spell and was never
 * charged for it, so removing the row would take a spell they own. Those rows
 * are refused rather than skipped quietly: an operator who asked to refund one
 * should be told why it did not happen.
 *
 * The spell itself is not removed here - only the worldserver can do that, and
 * only for an offline character safely. The refund frees the points; the spell
 * goes on the next respec.
 */
export async function refundPurchase(guid: number, nodeId: number): Promise<{ costPaid: number; spellId: number }> {
  const row = await queryOne<RowDataPacket & { cost_paid: number; spell_id: number; granted: number }>(
    `SELECT cost_paid, spell_id, granted FROM ${schema.chars}.\`classless_character_node\`
      WHERE guid = ? AND node_id = ? LIMIT 1`,
    [guid, nodeId],
  );
  if (!row) throw new Error("That character has not bought that node.");
  if (row.granted === 0) {
    throw new Error(
      "That node was never charged for — the character already knew the spell. Removing the row would " +
        "take a spell they own.",
    );
  }

  await transaction(async (run) => {
    await run.execute(
      `DELETE FROM ${schema.chars}.\`classless_character_node\` WHERE guid = ? AND node_id = ?`,
      [guid, nodeId],
    );
  });

  return { costPaid: Number(row.cost_paid ?? 0), spellId: row.spell_id };
}
