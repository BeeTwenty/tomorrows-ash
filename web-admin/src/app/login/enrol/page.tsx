import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EnrolForm } from "@/components/LoginForms";
import { clientAddress, preAuthGate } from "@/lib/authz";
import { beginEnrolment } from "@/lib/mfa";
import { loadSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up an authenticator" };

export default async function EnrolPage() {
  await preAuthGate();

  const lookup = await loadSession(await clientAddress());
  if (!lookup.ok) redirect(`/login?reason=${lookup.reason}`);
  if (lookup.session.stage === "pending_totp") redirect("/login/verify");
  if (lookup.session.stage === "active") redirect("/");

  const actor = lookup.session.actor;
  const enrolment = await beginEnrolment(actor.accountId, actor.username);

  // Already confirmed: the stage and the table disagree, which means another
  // tab finished this. Send them to the code screen rather than issuing a
  // second secret that would break the first.
  if (!enrolment) redirect("/login/verify");

  return (
    <>
      <p className="muted mt-5 text-sm">
        This panel requires a second factor. It is separate from the authenticator on your game
        login, if you have one.
      </p>
      <EnrolForm secret={enrolment.secret} uri={enrolment.uri} />
    </>
  );
}
