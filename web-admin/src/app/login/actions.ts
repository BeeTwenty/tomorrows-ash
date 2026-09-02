"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { preAuthGate } from "@/lib/authz";
import { confirmEnrolment, checkCode, redeemRecoveryCode, restartEnrolment } from "@/lib/mfa";
import { recordAttempt, signInWithPassword } from "@/lib/login";
import { clearSessionCookie, loadSession, promoteSession, revokeSession } from "@/lib/session";
import { clientAddress } from "@/lib/authz";

/**
 * The sign-in sequence, as three server actions.
 *
 * Each one re-runs the pre-auth checks itself. Server Actions are POST
 * endpoints with stable ids - reachable directly, not only from the form that
 * rendered them - so "the page checked already" is not a thing any of them may
 * assume.
 */

export interface FormState {
  error?: string;
  /** Shown once, never stored in the clear: the recovery codes at enrolment. */
  recoveryCodes?: string[];
}

async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export async function passwordAction(_state: FormState, form: FormData): Promise<FormState> {
  const address = await preAuthGate({ mutating: true });

  const result = await signInWithPassword({
    username: String(form.get("username") ?? ""),
    password: String(form.get("password") ?? ""),
    address,
    userAgent: await userAgent(),
  });

  if (!result.ok) return { error: result.reason };

  redirect(result.stage === "pending_enrolment" ? "/login/enrol" : "/login/verify");
}

export async function verifyAction(_state: FormState, form: FormData): Promise<FormState> {
  const address = await preAuthGate({ mutating: true });

  const lookup = await loadSession(address);
  if (!lookup.ok) redirect(`/login?reason=${lookup.reason}`);
  if (lookup.session.stage !== "pending_totp") redirect("/");

  const { actor, id } = { actor: lookup.session.actor, id: lookup.session.id };
  const usingRecovery = String(form.get("mode") ?? "") === "recovery";
  const value = String(form.get("code") ?? "");

  const result = usingRecovery
    ? await redeemRecoveryCode(actor.accountId, value, address)
    : await checkCode(actor.accountId, value);

  if (!result.ok) {
    await recordAttempt(usingRecovery ? "recovery" : "totp", false, address, actor.username);
    await audit({
      actor,
      action: "auth.totp_failed",
      outcome: "denied",
      targetType: "account",
      targetId: actor.accountId,
      targetLabel: actor.username,
      summary: result.reason,
      address,
      sessionId: id,
    });
    return { error: result.reason };
  }

  await promoteSession(id, "active");
  await recordAttempt(usingRecovery ? "recovery" : "totp", true, address, actor.username);
  await audit({
    actor,
    action: "auth.login",
    outcome: "ok",
    targetType: "account",
    targetId: actor.accountId,
    targetLabel: actor.username,
    summary: usingRecovery ? "Signed in with a recovery code." : "Signed in with an authenticator code.",
    address,
    sessionId: id,
  });

  redirect("/");
}

export async function enrolAction(_state: FormState, form: FormData): Promise<FormState> {
  const address = await preAuthGate({ mutating: true });

  const lookup = await loadSession(address);
  if (!lookup.ok) redirect(`/login?reason=${lookup.reason}`);
  if (lookup.session.stage !== "pending_enrolment") redirect("/");

  const actor = lookup.session.actor;
  const result = await confirmEnrolment(actor.accountId, String(form.get("code") ?? ""));
  if (!result.ok) return { error: result.reason };

  /**
   * The session is *not* promoted here. Enrolment ends by showing ten recovery
   * codes, which are shown exactly once; promoting first would let a stray
   * navigation lose them permanently. The "I have written these down" button
   * finishes the job.
   */
  return { recoveryCodes: result.recoveryCodes ?? [] };
}

/**
 * Discard an unconfirmed secret and issue a new one.
 *
 * Needed precisely because `beginEnrolment` now resumes rather than reissues:
 * someone who lost the device mid-setup has to be able to start again, and it
 * should be a button they pressed rather than something a stray page load did
 * to them.
 */
export async function restartEnrolmentAction(): Promise<void> {
  const address = await preAuthGate({ mutating: true });

  const lookup = await loadSession(address);
  if (!lookup.ok) redirect(`/login?reason=${lookup.reason}`);
  if (lookup.session.stage !== "pending_enrolment") redirect("/");

  await restartEnrolment(lookup.session.actor.accountId);
  redirect("/login/enrol");
}

export async function finishEnrolmentAction(): Promise<void> {
  const address = await preAuthGate({ mutating: true });

  const lookup = await loadSession(address);
  if (!lookup.ok) redirect(`/login?reason=${lookup.reason}`);

  await promoteSession(lookup.session.id, "active");
  await audit({
    actor: lookup.session.actor,
    action: "auth.login",
    outcome: "ok",
    targetType: "account",
    targetId: lookup.session.actor.accountId,
    targetLabel: lookup.session.actor.username,
    summary: "Enrolled an authenticator and signed in.",
    address,
    sessionId: lookup.session.id,
  });

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const address = await clientAddress();
  const lookup = await loadSession(address);

  if (lookup.ok) {
    await revokeSession(lookup.session.id, "signed-out");
    await audit({
      actor: lookup.session.actor,
      action: "auth.logout",
      outcome: "ok",
      targetType: "account",
      targetId: lookup.session.actor.accountId,
      targetLabel: lookup.session.actor.username,
      summary: "Signed out.",
      address,
      sessionId: lookup.session.id,
    });
  }

  await clearSessionCookie();
  redirect("/login?reason=none");
}
