import type { Metadata } from "next";
import { PasswordForm } from "@/components/LoginForms";
import { preAuthGate } from "@/lib/authz";
import { adminCookieName } from "@/lib/session";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/**
 * Why the visitor is here.
 *
 * The distinction between "your session expired" and "your password changed"
 * is worth making: the second means someone reset credentials, and an operator
 * who sees it without having done so has learned something important.
 *
 * None of these say anything an unauthenticated visitor did not already know -
 * they are all facts about a cookie the visitor is holding.
 */
const REASONS: Record<string, string> = {
  none: "",
  invalid: "That session is no longer valid. Sign in again.",
  expired: "Your session reached its maximum length and ended.",
  idle: "You were signed out after a period of inactivity.",
  revoked: "That session was ended.",
  address: "Your network address changed mid-session, so the session was ended.",
  credentials_changed: "Your account credentials changed, which ends every panel session.",
  not_staff: "That account no longer holds a staff level on this realm.",
  allowlist: "This panel is not reachable from your network.",
  stage: "Finish signing in.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  await preAuthGate();

  const { reason } = await searchParams;
  const message = reason ? REASONS[reason] : "";

  // Arriving at the sign-in page with a dead cookie should clear it, or the
  // middleware keeps waving the visitor through to a guard that keeps
  // bouncing them back here.
  if (reason && reason !== "none") {
    const store = await cookies();
    if (store.get(adminCookieName)) {
      store.set(adminCookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
    }
  }

  return (
    <>
      {message ? (
        <p className="notice notice-warn mt-5" role="status">
          {message}
        </p>
      ) : null}
      <PasswordForm />
      <p className="muted mt-5 text-xs">
        Use your game account. Staff access comes from your GM level on {""}
        this realm, not from a separate password.
      </p>
    </>
  );
}
