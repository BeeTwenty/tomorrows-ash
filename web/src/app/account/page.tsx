import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CharacterCard } from "@/components/CharacterCard";
import { EmberRule } from "@/components/EmberRule";
import { ChangePasswordForm } from "@/components/forms/ChangePasswordForm";
import { LogoutButton } from "@/components/forms/LogoutButton";
import { getAccountCharacters } from "@/lib/armory";
import { currentAccount } from "@/lib/auth-guard";
import { env } from "@/lib/env";
import { formatDate, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

/** Shows enough of an address to recognise it, never enough to leak it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "—";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login?next=/account");

  const { welcome } = await searchParams;
  const characters = await getAccountCharacters(account.id);

  return (
    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="display mt-4 text-5xl text-bone">{account.username}</h1>
        </div>
        <LogoutButton />
      </div>

      {welcome ? (
        <div className="panel panel-warm mt-8 px-5 py-5">
          <p className="display text-2xl text-bone">Your account is lit.</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ash">
            Use the same name and password in the game client. Point it at{" "}
            <code className="text-ember">{env.realm.address}</code> and make a character — the{" "}
            <Link href="/play" className="text-ember hover:underline">
              connection guide
            </Link>{" "}
            has the exact steps.
          </p>
        </div>
      ) : null}

      <dl className="mt-10 grid gap-px border border-edge bg-edge sm:grid-cols-3">
        <Detail label="Registered" value={formatDate(account.joinDate)} />
        <Detail label="Last login" value={account.lastLogin ? formatRelative(account.lastLogin) : "never"} />
        <Detail label="Email" value={maskEmail(account.email)} />
      </dl>

      <EmberRule className="my-14" />

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="display text-3xl text-bone">Your characters</h2>
          <Link href="/armory" className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash transition-colors hover:text-ember">
            Armory →
          </Link>
        </div>

        {characters.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((character) => (
              <CharacterCard key={character.guid} character={character} />
            ))}
          </div>
        ) : (
          <p className="panel mt-6 px-5 py-5 text-sm leading-relaxed text-ash">
            No characters yet. Log into the game client with this account and make one — it will appear
            here and in the armory as soon as it exists.
          </p>
        )}
      </section>

      <EmberRule className="my-14" />

      <section className="grid gap-10 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="display text-3xl text-bone">Change your password</h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ash">
            This changes the password for the game client too — they are the same account. Every other
            signed-in browser is signed out immediately.
          </p>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-ash/70">
            Maximum 16 characters, because that is all the 3.3.5a client can send.
          </p>
        </div>

        <div className="panel px-6 py-7">
          <ChangePasswordForm />
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-void px-5 py-4">
      <dt className="eyebrow text-[0.625rem]">{label}</dt>
      <dd className="mt-2 text-sm text-bone">{value}</dd>
    </div>
  );
}
