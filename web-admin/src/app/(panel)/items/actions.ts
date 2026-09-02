"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normaliseReason, performAudited, requirePermission } from "@/lib/authz";
import { getStaged, promoteChange, stageChange, withdrawChange } from "@/lib/items";

export interface ActionState {
  error?: string;
  ok?: string;
}

export async function stageAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const entry = Number.parseInt(String(form.get("entry") ?? ""), 10);
  const newValue = Number.parseInt(String(form.get("newValue") ?? ""), 10);

  const context = await requirePermission("item.stage", { mutating: true, targetType: "item", targetId: entry });

  if (!Number.isInteger(entry)) return { error: "That is not an item entry." };
  if (!Number.isInteger(newValue)) return { error: "That is not a class mask." };
  // -1 is "every class"; 0 is a valid, if drastic, "nobody". Anything outside
  // a 32-bit signed range is a typo.
  if (newValue < -1 || newValue > 2_147_483_647) return { error: "That class mask is out of range." };

  const reason = normaliseReason("item.stage", String(form.get("reason") ?? ""));

  try {
    const staged = await performAudited(
      context,
      "item.stage",
      {
        targetType: "item",
        targetId: entry,
        summary: `Staged AllowableClass → ${newValue}.`,
        reason,
        after: { AllowableClass: newValue },
      },
      () => stageChange({ entry, newValue, reason: reason ?? "", stagedBy: context.actor.username }),
    );

    revalidatePath("/items");
    return {
      ok: `Staged for ${staged.itemName ?? `item ${entry}`}: ${staged.oldValue} → ${staged.newValue}. Nothing has changed in the world database yet — an owner promotes it.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function promoteAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const context = await requirePermission("item.promote", { mutating: true, targetType: "item_change", targetId: id });

  const change = await getStaged(id);
  if (!change) return { error: "No such staged change." };

  const reason = normaliseReason("item.promote", String(form.get("reason") ?? ""));

  try {
    await performAudited(
      context,
      "item.promote",
      {
        targetType: "item",
        targetId: change.itemEntry,
        targetLabel: change.itemName,
        summary: `Promoted AllowableClass ${change.oldValue} → ${change.newValue} (staged by ${change.stagedBy}).`,
        reason,
        before: { AllowableClass: change.oldValue },
        after: { AllowableClass: change.newValue },
      },
      () => promoteChange(id, context.actor.username),
    );

    revalidatePath("/items");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  /**
   * Redirect rather than return a message.
   *
   * A promoted change leaves the staged list, so the table row holding this
   * form unmounts and takes any returned message with it - the operator would
   * see the row vanish and no confirmation. The notice is carried in the URL
   * and rendered by the page, which survives the re-render. `redirect` throws,
   * so it must be outside the try block.
   */
  redirect(`/items?notice=promoted&entry=${change.itemEntry}`);
}

export async function withdrawAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const context = await requirePermission("item.stage", { mutating: true, targetType: "item_change", targetId: id });

  const change = await getStaged(id);
  if (!change) return { error: "No such staged change." };

  try {
    await performAudited(
      context,
      "item.stage",
      {
        targetType: "item",
        targetId: change.itemEntry,
        targetLabel: change.itemName,
        summary: `Withdrew a staged change (${change.oldValue} → ${change.newValue}).`,
      },
      () => withdrawChange(id),
    );

    revalidatePath("/items");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  redirect(`/items?notice=withdrawn&entry=${change.itemEntry}`);
}
