"use server";

import { revalidatePath } from "next/cache";
import {
  banAccount,
  getAccount,
  setGmLevel,
  setLocked,
  setMute,
  setPassword,
  suggestPassword,
  unbanAccount,
} from "@/lib/accounts";
import { enforce, normaliseReason, performAudited, requirePermission } from "@/lib/authz";
import { env } from "@/lib/env";
import { canActOnAccount, canGrantLevel, roleForLevel, SEC_CONSOLE, SEC_PLAYER } from "@/lib/roles";
import { accountName, trySoap } from "@/lib/soap";

/**
 * Account actions.
 *
 * Every one of them follows the same four steps, in the same order, and the
 * order is the point:
 *
 *   1. `requirePermission` - does this role carry this action at all?
 *   2. Load the target *inside the action*. A page rendered five minutes ago is
 *      not evidence of anything; the target may have been promoted since.
 *   3. `enforce(canActOnAccount(...))` - may this actor act on this target?
 *      Separate from (1) because the answer depends on both parties.
 *   4. `performAudited` - do the work, and write down what happened either way.
 *
 * Skipping (2) is the subtle one. Authorising against a target id supplied by
 * the form, without re-reading that target's current level, is how a
 * time-of-check/time-of-use hole gets built.
 */

export interface ActionState {
  error?: string;
  ok?: string;
  /** A generated password, shown once. Never stored, never logged. */
  password?: string;
}

export async function banAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const accountId = Number.parseInt(String(form.get("accountId") ?? ""), 10);
  const context = await requirePermission("account.ban", { mutating: true, targetType: "account", targetId: accountId });

  const target = await getAccount(accountId);
  if (!target) return { error: "No such account." };

  await enforce(context, "account.ban", canActOnAccount(context.actor, target.gmLevel, target.id), {
    type: "account",
    id: target.id,
    label: target.username,
  });

  const reason = normaliseReason("account.ban", String(form.get("reason") ?? ""));
  const days = Number.parseInt(String(form.get("days") ?? "0"), 10) || 0;
  if (days < 0 || days > 3650) return { error: "A ban must be between 0 (permanent) and 3650 days." };
  const durationSeconds = days * 86_400;

  try {
    const kick = await performAudited(
      context,
      "account.ban",
      {
        targetType: "account",
        targetId: target.id,
        targetLabel: target.username,
        summary: days === 0 ? "Banned permanently." : `Banned for ${days} day(s).`,
        reason,
        before: { banned: target.banned, banReason: target.banReason },
        after: { banned: true, days, banReason: reason },
      },
      async () => {
        await banAccount({
          accountId: target.id,
          bannedBy: context.actor.username,
          reason: reason ?? "No reason given.",
          durationSeconds,
        });
        // A ban row does not disconnect anyone. If they are online, only the
        // worldserver can end the session, and the operator is told whether it
        // did rather than being left to assume.
        return target.online ? trySoap(`kick ${accountName(target.username)}`) : null;
      },
    );

    revalidatePath(`/accounts/${target.id}`);

    if (target.online && kick && !kick.ok) {
      return {
        ok: `${target.username} is banned, but the kick failed: ${kick.error}. They stay connected until they log out.`,
      };
    }
    return { ok: `${target.username} is banned${days === 0 ? " permanently" : ` for ${days} day(s)`}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function unbanAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const accountId = Number.parseInt(String(form.get("accountId") ?? ""), 10);
  const context = await requirePermission("account.unban", { mutating: true, targetType: "account", targetId: accountId });

  const target = await getAccount(accountId);
  if (!target) return { error: "No such account." };

  await enforce(context, "account.unban", canActOnAccount(context.actor, target.gmLevel, target.id), {
    type: "account",
    id: target.id,
    label: target.username,
  });

  const reason = normaliseReason("account.unban", String(form.get("reason") ?? ""));

  try {
    const cleared = await performAudited(
      context,
      "account.unban",
      {
        targetType: "account",
        targetId: target.id,
        targetLabel: target.username,
        summary: "Ban lifted.",
        reason,
        before: { banned: target.banned, banReason: target.banReason },
        after: { banned: false },
      },
      () => unbanAccount(target.id),
    );

    revalidatePath(`/accounts/${target.id}`);
    return cleared > 0
      ? { ok: `${target.username} is no longer banned.` }
      : { ok: `${target.username} had no active ban to lift.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resetPasswordAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const accountId = Number.parseInt(String(form.get("accountId") ?? ""), 10);
  const context = await requirePermission("account.password_reset", {
    mutating: true,
    targetType: "account",
    targetId: accountId,
  });

  const target = await getAccount(accountId);
  if (!target) return { error: "No such account." };

  await enforce(context, "account.password_reset", canActOnAccount(context.actor, target.gmLevel, target.id), {
    type: "account",
    id: target.id,
    label: target.username,
  });

  const password = suggestPassword();

  try {
    await performAudited(
      context,
      "account.password_reset",
      {
        targetType: "account",
        targetId: target.id,
        targetLabel: target.username,
        summary: "Password reset to a generated value.",
        reason: normaliseReason("account.password_reset", String(form.get("reason") ?? "")),
        // The new password is deliberately absent from before/after. The log
        // records that a reset happened; a log that records credentials is a
        // credential store.
        before: { verifierChanged: false },
        after: { verifierChanged: true },
      },
      () => setPassword(target.id, target.username, password),
    );

    revalidatePath(`/accounts/${target.id}`);
    return {
      ok: `Password reset. Read it to ${target.username} now — it is not stored anywhere and cannot be shown again.`,
      password,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setGmLevelAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const accountId = Number.parseInt(String(form.get("accountId") ?? ""), 10);
  const level = Number.parseInt(String(form.get("level") ?? ""), 10);

  const context = await requirePermission("account.set_gmlevel", {
    mutating: true,
    targetType: "account",
    targetId: accountId,
  });

  const target = await getAccount(accountId);
  if (!target) return { error: "No such account." };

  /**
   * The two-step escalation guard. `canGrantLevel` refuses a level at or above
   * the actor's own, refuses acting on a peer or superior, and refuses acting
   * on yourself - so there is no sequence of legal moves that ends with someone
   * holding more than they started with.
   */
  await enforce(
    context,
    "account.set_gmlevel",
    canGrantLevel(context.actor, { accountId: target.id, gmLevel: target.gmLevel }, level),
    { type: "account", id: target.id, label: target.username },
  );

  const reason = normaliseReason("account.set_gmlevel", String(form.get("reason") ?? ""));

  if (level < SEC_PLAYER || level > SEC_CONSOLE) return { error: "That is not a staff level." };

  try {
    await performAudited(
      context,
      "account.set_gmlevel",
      {
        targetType: "account",
        targetId: target.id,
        targetLabel: target.username,
        summary: `Staff level ${target.gmLevel} → ${level}.`,
        reason,
        before: { gmLevel: target.gmLevel, role: target.role },
        after: { gmLevel: level, role: roleForLevel(level) },
      },
      () => setGmLevel(target.id, level, env.realm.id),
    );

    revalidatePath(`/accounts/${target.id}`);
    return { ok: `${target.username} is now level ${level}. Their panel sessions have been ended.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function muteAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const accountId = Number.parseInt(String(form.get("accountId") ?? ""), 10);
  const minutes = Number.parseInt(String(form.get("minutes") ?? "0"), 10) || 0;

  const context = await requirePermission("account.mute", { mutating: true, targetType: "account", targetId: accountId });

  const target = await getAccount(accountId);
  if (!target) return { error: "No such account." };

  await enforce(context, "account.mute", canActOnAccount(context.actor, target.gmLevel, target.id), {
    type: "account",
    id: target.id,
    label: target.username,
  });

  if (minutes < 0 || minutes > 43_200) return { error: "A mute must be between 0 (lift) and 43200 minutes." };
  const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  const reason = normaliseReason("account.mute", String(form.get("reason") ?? ""));

  try {
    await performAudited(
      context,
      "account.mute",
      {
        targetType: "account",
        targetId: target.id,
        targetLabel: target.username,
        summary: minutes > 0 ? `Muted for ${minutes} minute(s).` : "Mute lifted.",
        reason,
        before: { mutedUntil: target.mutedUntil },
        after: { mutedUntil: until },
      },
      () => setMute(target.id, until),
    );

    revalidatePath(`/accounts/${target.id}`);
    return {
      ok:
        minutes > 0
          ? `${target.username} is muted for ${minutes} minute(s). It applies at their next login if they are online now.`
          : `${target.username} is no longer muted.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function lockAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const accountId = Number.parseInt(String(form.get("accountId") ?? ""), 10);
  const locked = String(form.get("locked") ?? "") === "1";

  const context = await requirePermission("account.ban", { mutating: true, targetType: "account", targetId: accountId });

  const target = await getAccount(accountId);
  if (!target) return { error: "No such account." };

  await enforce(context, "account.ban", canActOnAccount(context.actor, target.gmLevel, target.id), {
    type: "account",
    id: target.id,
    label: target.username,
  });

  try {
    await performAudited(
      context,
      "account.ban",
      {
        targetType: "account",
        targetId: target.id,
        targetLabel: target.username,
        // `locked` pins an account to its last IP. It is not a ban and should
        // not read as one in the log.
        summary: locked ? "IP lock enabled." : "IP lock disabled.",
        before: { locked: target.locked },
        after: { locked },
      },
      () => setLocked(target.id, locked),
    );

    revalidatePath(`/accounts/${target.id}`);
    return { ok: locked ? `${target.username} is locked to their last IP.` : `IP lock removed from ${target.username}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
