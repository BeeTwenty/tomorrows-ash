"use server";

import { revalidatePath } from "next/cache";
import { getAccount } from "@/lib/accounts";
import { enforce, normaliseReason, performAudited, requirePermission } from "@/lib/authz";
import {
  editCharacter,
  getCharacter,
  kickCharacter,
  queueAtLogin,
  reviveCharacter,
  teleportCharacter,
  type AtLoginFlag,
} from "@/lib/characters";
import { canActOnAccount } from "@/lib/roles";

/**
 * Character actions.
 *
 * The escalation guard is applied against the character's *owning account*, not
 * the character. Otherwise a GM could not be touched through their account but
 * could be through the level 80 they play on, which is the same access by a
 * different door.
 */

export interface ActionState {
  error?: string;
  ok?: string;
}

async function guard(permission: Parameters<typeof requirePermission>[0], guid: number) {
  const context = await requirePermission(permission, { mutating: true, targetType: "character", targetId: guid });
  const character = await getCharacter(guid);
  if (!character) return { context, character: null, owner: null } as const;

  const owner = await getAccount(character.accountId);
  await enforce(context, permission, canActOnAccount(context.actor, owner?.gmLevel ?? 0, character.accountId), {
    type: "character",
    id: guid,
    label: character.name,
  });

  return { context, character, owner } as const;
}

export async function editCharacterAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const guid = Number.parseInt(String(form.get("guid") ?? ""), 10);
  const { context, character } = await guard("character.edit", guid);
  if (!character) return { error: "No such character." };

  const reason = normaliseReason("character.edit", String(form.get("reason") ?? ""));

  const level = form.get("level") ? Number.parseInt(String(form.get("level")), 10) : undefined;
  const gold = form.get("gold") !== null && String(form.get("gold")) !== "" ? Number(form.get("gold")) : undefined;

  const edit: { level?: number; money?: number } = {};
  if (level !== undefined && level !== character.level) edit.level = level;
  // The form asks for gold because that is what a player says; the column is
  // copper.
  if (gold !== undefined && Math.round(gold * 10_000) !== character.money) edit.money = Math.round(gold * 10_000);

  if (Object.keys(edit).length === 0) return { error: "Nothing changed." };

  try {
    const change = await performAudited(
      context,
      "character.edit",
      {
        targetType: "character",
        targetId: character.guid,
        targetLabel: character.name,
        summary: `Edited ${Object.keys(edit).join(", ")}.`,
        reason,
        before: { level: character.level, money: character.money },
        after: edit,
      },
      () => editCharacter(character.guid, edit),
    );

    revalidatePath(`/characters/${character.guid}`);
    return { ok: `${character.name} updated: ${JSON.stringify(change.after)}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function kickAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const guid = Number.parseInt(String(form.get("guid") ?? ""), 10);
  const { context, character } = await guard("character.kick", guid);
  if (!character) return { error: "No such character." };
  if (!character.online) return { error: `${character.name} is not online.` };

  const attempt = await performAudited(
    context,
    "character.kick",
    {
      targetType: "character",
      targetId: character.guid,
      targetLabel: character.name,
      summary: "Disconnected from the world.",
      reason: normaliseReason("character.kick", String(form.get("reason") ?? "")),
    },
    () => kickCharacter(character.name),
  );

  revalidatePath(`/characters/${character.guid}`);
  return attempt.ok ? { ok: `${character.name} was disconnected.` } : { error: attempt.error ?? "The kick failed." };
}

export async function reviveAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const guid = Number.parseInt(String(form.get("guid") ?? ""), 10);
  const { context, character } = await guard("character.revive", guid);
  if (!character) return { error: "No such character." };

  const attempt = await performAudited(
    context,
    "character.revive",
    {
      targetType: "character",
      targetId: character.guid,
      targetLabel: character.name,
      summary: "Revived.",
    },
    () => reviveCharacter(character.name),
  );

  revalidatePath(`/characters/${character.guid}`);
  return attempt.ok ? { ok: `${character.name} was revived.` } : { error: attempt.error ?? "The revive failed." };
}

export async function teleportAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const guid = Number.parseInt(String(form.get("guid") ?? ""), 10);
  const teleportId = Number.parseInt(String(form.get("teleportId") ?? ""), 10);
  const { context, character } = await guard("character.teleport", guid);
  if (!character) return { error: "No such character." };
  if (!Number.isInteger(teleportId)) return { error: "Pick a destination." };

  const attempt = await performAudited(
    context,
    "character.teleport",
    {
      targetType: "character",
      targetId: character.guid,
      targetLabel: character.name,
      summary: `Teleported (game_tele ${teleportId}).`,
      reason: normaliseReason("character.teleport", String(form.get("reason") ?? "")),
    },
    () => teleportCharacter(character.name, teleportId),
  );

  revalidatePath(`/characters/${character.guid}`);
  return attempt.ok ? { ok: `${character.name} was teleported.` } : { error: attempt.error ?? "The teleport failed." };
}

const FLAG_LABELS: Record<AtLoginFlag, string> = {
  rename: "a forced rename",
  resetSpells: "a spell reset",
  resetTalents: "a talent reset",
  customize: "an appearance change",
  changeFaction: "a faction change",
  changeRace: "a race change",
};

/**
 * Queue something for the character's next login.
 *
 * Safe while they are online, unlike a direct edit: `at_login` is read when
 * the session starts, so it lands next time either way.
 */
export async function queueAtLoginAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const guid = Number.parseInt(String(form.get("guid") ?? ""), 10);
  const flag = String(form.get("flag") ?? "") as AtLoginFlag;
  if (!(flag in FLAG_LABELS)) return { error: "Unknown flag." };

  const { context, character } = await guard("character.edit", guid);
  if (!character) return { error: "No such character." };

  try {
    await performAudited(
      context,
      "character.edit",
      {
        targetType: "character",
        targetId: character.guid,
        targetLabel: character.name,
        summary: `Queued ${FLAG_LABELS[flag]} for next login.`,
        reason: normaliseReason("character.edit", String(form.get("reason") ?? "")),
        after: { at_login: flag },
      },
      () => queueAtLogin(character.guid, flag),
    );

    revalidatePath(`/characters/${character.guid}`);
    return { ok: `${character.name} will be offered ${FLAG_LABELS[flag]} at their next login.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
