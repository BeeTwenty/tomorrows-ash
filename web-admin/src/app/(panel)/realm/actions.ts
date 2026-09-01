"use server";

import { revalidatePath } from "next/cache";
import { normaliseReason, performAudited, requirePermission } from "@/lib/authz";
import { announce, getRealm, realmStatus, setMaintenance, setMotd } from "@/lib/realm";

export interface ActionState {
  error?: string;
  ok?: string;
}

export async function motdAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const context = await requirePermission("realm.motd", { mutating: true });
  const text = String(form.get("motd") ?? "");
  if (!text.trim()) return { error: "The message cannot be empty." };

  const status = await realmStatus();

  const result = await performAudited(
    context,
    "realm.motd",
    {
      targetType: "realm",
      targetId: "motd",
      summary: "Message of the day changed.",
      before: { motd: status.motd },
      after: { motd: text.trim() },
    },
    () => setMotd(text),
  );

  revalidatePath("/realm");

  if (!result.live.attempted) {
    return {
      ok: "Saved. The running server keeps the old message until it restarts — configure the console to change it live.",
    };
  }
  return result.live.ok
    ? { ok: "Saved and live." }
    : { ok: `Saved, but the running server was not updated: ${result.live.error}` };
}

export async function maintenanceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const context = await requirePermission("realm.maintenance", { mutating: true });
  const level = Number.parseInt(String(form.get("level") ?? ""), 10);
  if (!Number.isInteger(level) || level < 0 || level > 4) return { error: "Pick a level between 0 and 4." };

  const realm = await getRealm();
  const reason = normaliseReason("realm.maintenance", String(form.get("reason") ?? ""));

  try {
    await performAudited(
      context,
      "realm.maintenance",
      {
        targetType: "realm",
        targetId: String(realm?.id ?? "?"),
        targetLabel: realm?.name ?? null,
        summary:
          level === 0
            ? "Maintenance lifted; the realm accepts everyone."
            : `Maintenance on: minimum staff level ${level}.`,
        reason,
        before: { allowedSecurityLevel: realm?.allowedSecurityLevel },
        after: { allowedSecurityLevel: level },
      },
      () => setMaintenance(level),
    );

    revalidatePath("/realm");
    return {
      ok:
        level === 0
          ? "The realm is open. It takes effect on the next login attempt — nobody already connected is affected."
          : `Only accounts at level ${level} and above can log in from now on. Players already connected stay connected.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function announceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const context = await requirePermission("realm.announce", { mutating: true });
  const message = String(form.get("message") ?? "").trim();
  if (!message) return { error: "The announcement cannot be empty." };

  const attempt = await performAudited(
    context,
    "realm.announce",
    { targetType: "realm", targetId: "announce", summary: `Announced: ${message.slice(0, 200)}` },
    () => announce(message),
  );

  if (!attempt.attempted) return { error: "The worldserver console is not configured, so nothing was sent." };
  return attempt.ok ? { ok: "Announced." } : { error: `The announcement failed: ${attempt.error}` };
}
