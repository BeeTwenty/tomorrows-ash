import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/LoginForms";
import { clientAddress, preAuthGate } from "@/lib/authz";
import { loadSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Authenticator" };

export default async function VerifyPage() {
  await preAuthGate();

  const lookup = await loadSession(await clientAddress());
  if (!lookup.ok) redirect(`/login?reason=${lookup.reason}`);
  if (lookup.session.stage === "pending_enrolment") redirect("/login/enrol");
  if (lookup.session.stage === "active") redirect("/");

  return (
    <>
      <p className="muted mt-5 text-sm">
        Signed in as <span className="mono text-[var(--color-bone)]">{lookup.session.actor.username}</span>.
        One more step.
      </p>
      <VerifyForm />
    </>
  );
}
