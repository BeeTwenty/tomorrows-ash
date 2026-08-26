import type { Metadata } from "next";
import Link from "next/link";
import { EmberRule } from "@/components/EmberRule";
import { getRealmStatus } from "@/lib/realm";
import { env } from "@/lib/env";

/**
 * Never prerendered. This page reads the realm database and the realm's
 * configuration, both of which belong to the *running* deployment - a build
 * that happened on another machine, or in a container with no database, must
 * not be able to bake its answers into the output. Load is handled by the
 * cache inside the data layer instead.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect to Ashmorrow",
  description: "How to point a World of Warcraft 3.3.5a client at the Ashmorrow realm.",
};

export default async function PlayPage() {
  const status = await getRealmStatus();

  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <p className="eyebrow">Connect</p>
      <h1 className="display mt-6 text-5xl text-bone sm:text-6xl">Four steps and a client.</h1>
      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ash">
        Ashmorrow runs on the 3.3.5a client, build 12340. There is nothing to install beyond the game
        itself — no launcher, no patch, no addon. The classless system was deliberately built so that an
        unmodified client works.
      </p>

      <ol className="mt-14 space-y-px border border-edge bg-edge">
        <Step
          number="01"
          title="Get a 3.3.5a client"
          body={
            <>
              You supply your own copy of World of Warcraft 3.3.5a (build 12340). We distribute no
              Blizzard files and never will — that is not a policy we can bend.
            </>
          }
        />
        <Step
          number="02"
          title="Create an account"
          body={
            <>
              One account, used on the site and in the game client. Account names and passwords are
              capped at 16 characters because the client cannot send more.{" "}
              <Link href="/register" className="text-ember hover:underline">
                Create one here
              </Link>
              .
            </>
          }
        />
        <Step
          number="03"
          title="Point the client at the realm"
          body={
            <>
              Open <code className="text-ember">realmlist.wtf</code> in your client folder — it lives in{" "}
              <code className="text-ember">Data\\enUS\\</code> or the equivalent locale folder — and
              replace its contents with a single line:
              <pre className="scroll-x mt-3 border border-edge bg-void px-4 py-3">
                <code className="numeric text-sm text-bone">set realmlist {status.address}</code>
              </pre>
              <span className="mt-3 block text-xs text-ash/80">
                Some clients read <code>WTF\\Config.wtf</code> instead. If one does not take, edit both.
              </span>
            </>
          }
        />
        <Step
          number="04"
          title="Log in"
          body={
            <>
              Launch <code className="text-ember">Wow.exe</code> directly rather than the launcher, and
              sign in with the account you created. Ashmorrow should appear in the realm list.
            </>
          }
        />
      </ol>

      <EmberRule className="my-14" />

      <section>
        <p className="eyebrow">If it does not work</p>
        <dl className="mt-6 space-y-6">
          <Trouble
            problem="The launcher updates or refuses to start"
            fix={`Run Wow.exe directly. The Blizzard launcher will try to patch the client past 3.3.5a.`}
          />
          <Trouble
            problem="Unable to connect"
            fix={`The login server is at ${status.address}:${status.authPort}. Check the realm status page — if the login server is down, nothing on your side will help.`}
          />
          <Trouble
            problem="Login works, but the realm shows offline or greyed out"
            fix="The world server is down or restarting, or the realm is advertising an address your machine cannot reach. The status page distinguishes the two."
          />
          <Trouble
            problem="Wrong password, but you are sure it is right"
            fix="Account names and passwords are case-insensitive but capped at 16 characters. If you set a longer one somewhere else, the client silently truncated it."
          />
        </dl>

        <p className="mt-10 text-sm text-ash">
          Still stuck? The{" "}
          <Link href="/docs/getting-started" className="text-ember hover:underline">
            getting started guide
          </Link>{" "}
          goes into more detail, and the{" "}
          <Link href="/status" className="text-ember hover:underline">
            realm status page
          </Link>{" "}
          tells you whether the problem is yours or ours.
        </p>
      </section>

      <p className="mt-12 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash/60">
        {env.realm.name} · 3.3.5a build 12340 · ports {status.authPort} and {status.worldPort}
      </p>
    </div>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: React.ReactNode }) {
  return (
    <li className="bg-void px-6 py-6">
      <span className="numeric text-xs text-ember">{number}</span>
      <h2 className="display mt-3 text-2xl text-bone">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-ash">{body}</div>
    </li>
  );
}

function Trouble({ problem, fix }: { problem: string; fix: string }) {
  return (
    <div className="border-l border-edge pl-4">
      <dt className="text-sm text-bone">{problem}</dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-ash">{fix}</dd>
    </div>
  );
}
