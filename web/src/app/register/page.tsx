import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/forms/RegisterForm";
import { currentAccount } from "@/lib/auth-guard";
import { env, isDemo } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create an account",
  description: `One account for the site and the game client on realm ${env.realm.name}.`,
};

export default async function RegisterPage() {
  if (await currentAccount()) redirect("/account");

  const closed = !env.accounts.registrationEnabled;

  return (
    <div className="mx-auto grid max-w-5xl gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1fr]">
      <div>
        <p className="eyebrow">Register</p>
        <h1 className="display mt-6 text-5xl text-bone">Kindle an account.</h1>
        <p className="mt-6 text-sm leading-relaxed text-ash">
          One account gets you the site and the game client. It is created directly on the realm&rsquo;s
          own login server, with the same password handling the client uses — we never store a
          reversible copy of what you type.
        </p>

        <ul className="mt-8 space-y-3 text-sm text-ash">
          <li className="border-l border-edge pl-4">
            Account names and passwords are capped at 16 characters. That is the game client&rsquo;s
            limit, not ours.
          </li>
          <li className="border-l border-edge pl-4">
            Your email is only ever used to reset a password. It is never shown on the site.
          </li>
          <li className="border-l border-edge pl-4">
            Already have one?{" "}
            <Link href="/login" className="text-ember hover:underline">
              Sign in
            </Link>
            .
          </li>
        </ul>
      </div>

      <div className="panel px-6 py-7">
        {isDemo ? (
          <p className="mb-6 border-l-2 border-edge-warm bg-smoke px-4 py-3 text-xs leading-relaxed text-ash">
            <strong className="text-ash-bright">Demo mode.</strong> No realm database is attached, so
            registration is switched off. The form is here so the flow can be reviewed.
          </p>
        ) : null}

        {closed ? (
          <p className="mb-6 border-l-2 border-ember-dim bg-ember/5 px-4 py-3 text-sm text-bone">
            Registration is closed on this realm right now.
          </p>
        ) : null}

        <RegisterForm disabled={closed} />
      </div>
    </div>
  );
}
