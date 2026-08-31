"use server";

import { revalidatePath } from "next/cache";
import { normaliseReason, performAudited, requirePermission } from "@/lib/authz";
import { editNode, editTree, getNode, listTrees, reloadTrees } from "@/lib/trees";

export interface ActionState {
  error?: string;
  ok?: string;
}

/**
 * Tree and node edits.
 *
 * The realm is meant to be rebalanced without a recompile - that is the "data
 * over code" invariant in CLAUDE.md §2 - so this page is the intended way to do
 * it. Two things follow from that being intended rather than an escape hatch:
 *
 *   - Every change carries a reason, because a price that moved without a
 *     recorded argument is a price nobody can defend three months later.
 *   - Every change offers a reload, because the module caches trees at load and
 *     an edit that is true in the database and false in the world is the most
 *     confusing state this page can produce.
 */

export async function editNodeAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const nodeId = Number.parseInt(String(form.get("nodeId") ?? ""), 10);
  const context = await requirePermission("tree.edit", { mutating: true, targetType: "node", targetId: nodeId });

  const node = await getNode(nodeId);
  if (!node) return { error: "No such node." };

  const edit = {
    name: readString(form, "name"),
    description: readString(form, "description"),
    cost: readInt(form, "cost"),
    requiredLevel: readInt(form, "requiredLevel"),
    tier: readInt(form, "tier"),
    enabled: form.get("enabled") === null ? undefined : String(form.get("enabled")) === "1",
  };

  const changed = Object.fromEntries(
    Object.entries(edit).filter(([key, value]) => {
      if (value === undefined) return false;
      const current = node[key as keyof typeof node];
      return current !== value;
    }),
  );

  if (Object.keys(changed).length === 0) return { error: "Nothing changed." };

  const reason = normaliseReason("tree.edit", String(form.get("reason") ?? ""));

  try {
    await performAudited(
      context,
      "tree.edit",
      {
        targetType: "node",
        targetId: node.id,
        targetLabel: `${node.treeName} · ${node.name}`,
        summary:
          node.purchases > 0
            ? `Edited a node ${node.purchases} character(s) have already bought.`
            : "Edited a node nobody has bought yet.",
        reason,
        before: {
          name: node.name,
          description: node.description,
          cost: node.cost,
          requiredLevel: node.requiredLevel,
          tier: node.tier,
          enabled: node.enabled,
        },
        after: changed,
      },
      () => editNode(node.id, changed),
    );

    revalidatePath("/trees");

    const priceMoved = "cost" in changed;
    return {
      ok: priceMoved
        ? `Saved. Characters who already bought this node keep the price they paid (cost_paid), so the change applies to new purchases only. Reload the trees to make it live.`
        : "Saved. Reload the trees to make it live.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function editTreeAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const treeId = Number.parseInt(String(form.get("treeId") ?? ""), 10);
  const context = await requirePermission("tree.edit", { mutating: true, targetType: "tree", targetId: treeId });

  const tree = (await listTrees()).find((entry) => entry.id === treeId);
  if (!tree) return { error: "No such tree." };

  const edit = {
    name: readString(form, "name"),
    description: readString(form, "description"),
    enabled: form.get("enabled") === null ? undefined : String(form.get("enabled")) === "1",
  };

  const changed = Object.fromEntries(
    Object.entries(edit).filter(([key, value]) => value !== undefined && tree[key as keyof typeof tree] !== value),
  );
  if (Object.keys(changed).length === 0) return { error: "Nothing changed." };

  try {
    await performAudited(
      context,
      "tree.edit",
      {
        targetType: "tree",
        targetId: tree.id,
        targetLabel: tree.name,
        summary: `Edited tree (${tree.nodeCount} nodes).`,
        reason: normaliseReason("tree.edit", String(form.get("reason") ?? "")),
        before: { name: tree.name, description: tree.description, enabled: tree.enabled },
        after: changed,
      },
      () => editTree(tree.id, changed),
    );

    revalidatePath("/trees");
    return { ok: "Saved. Reload the trees to make it live." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function reloadAction(_state: ActionState): Promise<ActionState> {
  const context = await requirePermission("tree.reload", { mutating: true });

  const attempt = await performAudited(
    context,
    "tree.reload",
    { targetType: "realm", targetId: "trees", summary: "Reloaded the classless trees." },
    () => reloadTrees(),
  );

  revalidatePath("/trees");
  if (!attempt.attempted) {
    return {
      error:
        "The worldserver console is not configured, so the running server still has the old trees. " +
        "They will be picked up at its next restart.",
    };
  }
  return attempt.ok
    ? { ok: attempt.output?.trim() || "Trees reloaded." }
    : { error: `The reload failed: ${attempt.error}` };
}

function readString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return value === null ? undefined : String(value);
}

function readInt(form: FormData, key: string): number | undefined {
  const value = form.get(key);
  if (value === null || String(value) === "") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
