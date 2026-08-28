"use server";

import { redirect } from "next/navigation";
import {
  authenticate,
  changePassword,
  consumePasswordReset,
  createPasswordReset,
  registerAccount,
  resolveSession,
} from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { env, isDemo } from "@/lib/env";
import { passwordResetMail, sendMail } from "@/lib/mail";
import { RATE_RULES, consumeAll, rateLimitMessage } from "@/lib/rate-limit";
import { assertSameOrigin, clientAddress } from "@/lib/request";
import {
  clearSessionCookie,
  newSessionPayload,
  readSessionCookie,
  writeSessionCookie,
} from "@/lib/session";
import { validateEmail, validatePassword, validateUsername } from "@/lib/validation";
import type { FormState } from "@/lib/form";

/**
 * Every account form runs the same four steps before it touches the database:
 *
 *   1. refuse cross-origin posts,
 *   2. spend rate-limit budget on both the address and the identity,
 *   3. validate input against the *game client's* limits, not the web's,
 *   4. act, and record what happened in the audit log.
 *
 * Failures come back as a returned FormState rather than an exception, so the
 * page can re-render the form with the message attached to the right field.
 */

const field = (error: string, name: FormState["field"] = "form"): FormState => ({ error, field: name });

const text = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

export async function registerAction(_prev: FormState, data: FormData): Promise<FormState> {
  await assertSameOrigin();

  if (isDemo) {
    return field("This site is running in demo mode with no realm attached, so registration is off.");
  }
  if (!env.accounts.registrationEnabled) {
    return field("Registration is closed on this realm right now.");
  }

  const address = await clientAddress();
  const username = validateUsername(text(data, "username"));
  if (!username.ok) return field(username.error, "username");

  const limit = await consumeAll([
    { key: `register:ip:${address}`, rule: RATE_RULES.register },
    { key: `register:name:${username.value}`, rule: RATE_RULES.register },
  ]);
  if (!limit.allowed) return field(rateLimitMessage(limit));

  const password = validatePassword(text(data, "password"), username.value);
  if (!password.ok) return field(password.error, "password");

  if (text(data, "password") !== text(data, "confirm")) {
    return field("Those two passwords are not the same.", "password");
  }

  const email = validateEmail(text(data, "email"));
  if (!email.ok) return field(email.error, "email");

  const result = await registerAccount({
    username: username.value,
    password: password.value,
    email: email.value,
    address,
  });
  if (!result.ok) return field(result.error, result.field);

  // A fresh account is signed in immediately - the credentials were just
  // verified by construction, so a second login form would be theatre.
  const authenticated = await authenticate({
    username: username.value,
    password: password.value,
    address,
  });
  if (authenticated.ok) {
    await writeSessionCookie(
      newSessionPayload(authenticated.value.id, authenticated.value.username, authenticated.value.fingerprint),
    );
  }

  redirect("/account?welcome=1");
}

export async function loginAction(_prev: FormState, data: FormData): Promise<FormState> {
  await assertSameOrigin();

  if (isDemo) {
    return field("This site is running in demo mode with no realm attached, so sign-in is off.");
  }

  const address = await clientAddress();
  const username = validateUsername(text(data, "username"));
  const password = text(data, "password");

  // Rate limiting happens before validation so a malformed flood still counts.
  const limit = await consumeAll([
    { key: `login:ip:${address}`, rule: RATE_RULES.login },
    { key: `login:name:${username.ok ? username.value : "invalid"}`, rule: RATE_RULES.loginIdentity },
  ]);
  if (!limit.allowed) return field(rateLimitMessage(limit));

  if (!username.ok || !password) {
    return field("That account name and password do not match.", "password");
  }

  const result = await authenticate({ username: username.value, password, address });
  if (!result.ok) return field(result.error, result.field);

  await writeSessionCookie(newSessionPayload(result.value.id, result.value.username, result.value.fingerprint));

  const next = text(data, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/account");
}

export async function logoutAction(): Promise<void> {
  await assertSameOrigin();
  const session = await readSessionCookie();
  await clearSessionCookie();
  if (session) {
    await audit("logout", { accountId: session.aid, username: session.u, address: await clientAddress() });
  }
  redirect("/");
}

export async function forgotAction(_prev: FormState, data: FormData): Promise<FormState> {
  await assertSameOrigin();

  const settled: FormState = {
    notice:
      "If that address belongs to an account, a reset link is on its way. The link works once and expires shortly.",
    done: true,
  };

  if (isDemo) return field("This site is running in demo mode with no realm attached.");
  if (env.mail.transport === "disabled") {
    return field("Password reset is switched off on this site. Contact the realm staff.");
  }

  const address = await clientAddress();
  const limit = await consumeAll([
    { key: `forgot:ip:${address}`, rule: RATE_RULES.passwordResetRequest },
  ]);
  if (!limit.allowed) return field(rateLimitMessage(limit));

  const email = validateEmail(text(data, "email"));
  if (!email.ok) return field(email.error, "email");

  const outcome = await createPasswordReset(email.value, address);

  // Whether or not an account matched, the answer to the visitor is identical.
  if (outcome.issued && outcome.account && outcome.link) {
    const mail = passwordResetMail(outcome.account.username, outcome.link, env.accounts.resetTokenMinutes);
    await sendMail({ ...mail, to: outcome.account.email });
  }

  return settled;
}

export async function resetAction(_prev: FormState, data: FormData): Promise<FormState> {
  await assertSameOrigin();

  if (isDemo) return field("This site is running in demo mode with no realm attached.");

  const address = await clientAddress();
  const limit = await consumeAll([
    { key: `reset:ip:${address}`, rule: RATE_RULES.passwordResetSubmit },
  ]);
  if (!limit.allowed) return field(rateLimitMessage(limit));

  const token = text(data, "token");
  if (!token) return field("That reset link is incomplete. Request a new one.", "token");

  const password = validatePassword(text(data, "password"));
  if (!password.ok) return field(password.error, "password");
  if (text(data, "password") !== text(data, "confirm")) {
    return field("Those two passwords are not the same.", "password");
  }

  const result = await consumePasswordReset(token, password.value, address);
  if (!result.ok) return field(result.error, result.field);

  redirect("/login?reset=1");
}

export async function changePasswordAction(_prev: FormState, data: FormData): Promise<FormState> {
  await assertSameOrigin();

  const session = await readSessionCookie();
  if (!session) return field("Your session has expired. Sign in again.");

  const account = await resolveSession(session.aid, session.fp);
  if (!account) {
    await clearSessionCookie();
    return field("Your session is no longer valid. Sign in again.");
  }

  const address = await clientAddress();
  const limit = await consumeAll([
    { key: `password:acct:${account.id}`, rule: RATE_RULES.passwordChange },
    { key: `password:ip:${address}`, rule: RATE_RULES.passwordChange },
  ]);
  if (!limit.allowed) return field(rateLimitMessage(limit));

  const next = validatePassword(text(data, "password"), account.username);
  if (!next.ok) return field(next.error, "password");
  if (text(data, "password") !== text(data, "confirm")) {
    return field("Those two passwords are not the same.", "password");
  }

  const result = await changePassword({
    accountId: account.id,
    currentPassword: text(data, "current"),
    newPassword: next.value,
    address,
  });
  if (!result.ok) return field(result.error, result.field);

  // Changing the password invalidates every session, including this one, so
  // the cookie is reissued against the new credentials.
  await writeSessionCookie(newSessionPayload(account.id, account.username, result.value.fingerprint));

  return { notice: "Password changed. Use the new one in the game client too.", done: true };
}
