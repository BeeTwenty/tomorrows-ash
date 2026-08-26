import Link from "next/link";
import { EmberRule } from "@/components/EmberRule";
import { getRealmStatus } from "@/lib/realm";
import { env, isDemo } from "@/lib/env";
import { formatNumber } from "@/lib/format";

/**
 * Never prerendered. This page reads the realm database and the realm's
 * configuration, both of which belong to the *running* deployment - a build
 * that happened on another machine, or in a container with no database, must
 * not be able to bake its answers into the output. Load is handled by the
 * cache inside the data layer instead.
 */
export const dynamic = "force-dynamic";

const BEATS = [
  {
    number: "01",
    title: "A body, not a class",
    body:
      "You still choose a race and a frame — tough, fragile, quick. That frame decides how much " +
      "health you carry and what armour you can wear. It decides nothing about what you can learn.",
  },
  {
    number: "02",
    title: "One budget, every tree",
    body:
      "Fire. Frost. Sword mastery. Stealth. Warding. They are all open, and they all draw from the " +
      "same pool of skill points. Depth costs you breadth. That trade is the whole game.",
  },
  {
    number: "03",
    title: "Nothing is final",
    body:
      "Spend wrong and you can unspend. A character is not a class you picked at creation — it is " +
      "the sum of what you have committed to so far, and that can change.",
  },
];

export default async function LandingPage() {
  const status = await getRealmStatus();

  return (
    <>
      {/* ---------------------------------------------------------------- *
          Hero
       * ---------------------------------------------------------------- */}
      <section className="mx-auto flex min-h-[86dvh] max-w-6xl flex-col justify-center px-5 py-24 sm:px-8">
        <p className="eyebrow reveal">Realm I — {env.realm.name}</p>

        <h1 className="display reveal delay-1 mt-8 text-[clamp(2.75rem,10vw,7rem)] text-bone">
          You are not a class.
          <br />
          <span className="text-ember">You are what you spend.</span>
        </h1>

        <p className="reveal delay-2 mt-10 max-w-xl text-base leading-relaxed text-ash-bright">
          A classless World of Warcraft realm. No class-locked spellbooks, no fixed talent trees —
          one shared skill budget and every ability in the world to spend it on.
        </p>

        <div className="reveal delay-3 mt-10 flex flex-wrap items-center gap-4">
          <Link href="/register" className="btn btn-ember">
            Create an account
          </Link>
          <Link href="/docs/classless" className="btn">
            What classless means
          </Link>
        </div>

        <div className="reveal delay-4 mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash">
          <span className="flex items-center gap-2.5">
            <span className={status.online ? "pulse pulse-live" : "pulse pulse-dead"} aria-hidden="true" />
            {status.online ? "Kindled" : "Dark"}
          </span>
          <span>{formatNumber(status.playersOnline)} in the world</span>
          {status.charactersTotal !== null ? (
            <span>{formatNumber(status.charactersTotal)} characters written</span>
          ) : null}
          <Link href="/status" className="transition-colors hover:text-ember">
            Realm status →
          </Link>
        </div>

        {isDemo ? (
          <p className="reveal delay-5 mt-8 max-w-xl border-l-2 border-edge-warm bg-smoke/60 px-4 py-3 text-xs leading-relaxed text-ash">
            <strong className="text-ash-bright">Demo mode.</strong> No realm database is attached to this
            site yet, so the figures above and the armory below are illustrative. Point{" "}
            <code className="text-ember">DB_HOST</code> at a running Ashmorrow and everything becomes real.
          </p>
        ) : null}
      </section>

      <EmberRule />

      {/* ---------------------------------------------------------------- *
          What classless means, in three beats
       * ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <p className="eyebrow">The fire took the classes</p>
        <h2 className="display mt-6 max-w-2xl text-4xl text-bone sm:text-5xl">
          What is left is a budget and a decision.
        </h2>

        <div className="mt-16 grid gap-px border border-edge bg-edge sm:grid-cols-3">
          {BEATS.map((beat) => (
            <article key={beat.number} className="bg-void px-6 py-8">
              <span className="numeric text-xs text-ember">{beat.number}</span>
              <h3 className="display mt-4 text-2xl text-bone">{beat.title}</h3>
              <p className="mt-4 text-sm leading-relaxed text-ash">{beat.body}</p>
            </article>
          ))}
        </div>

        <p className="cryptic mt-12 max-w-2xl text-xl">
          A warrior who learned to conjure fire is not a mage. He is a warrior who paid for fire with
          something he no longer has.
        </p>
      </section>

      <EmberRule />

      {/* ---------------------------------------------------------------- *
          Honest status
       * ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="eyebrow">Where the work is</p>
            <h2 className="display mt-6 text-4xl text-bone">
              Being built in the open, one phase at a time.
            </h2>
            <p className="mt-6 max-w-lg text-sm leading-relaxed text-ash">
              Tomorrow&rsquo;s Ash is built on AzerothCore for the 3.3.5a client, and every line of it is
              public. The classless system needs no modified game client — no patch to install, no
              custom launcher. What it needs is time, and we would rather tell you exactly where we are
              than pretend the realm is finished.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/patch-notes" className="btn">
                Patch notes
              </Link>
              <Link href="/docs/roadmap" className="btn">
                The roadmap
              </Link>
            </div>
          </div>

          <dl className="space-y-px border border-edge bg-edge">
            {[
              ["Phase 0", "Foundation", "Complete", "Core chosen, realm named, class restrictions mapped. Zero core patches needed."],
              ["Phase 1", "First off-class ability", "In progress", "A warrior casts Fireball. A mage swings Mortal Strike. Both survive a relog."],
              ["Phase 2", "The skill budget", "Next", "Points, trees, respecs. The real system, and the point of the project."],
              ["Phase 3", "Itemisation", "Later", "Gear stops assuming a class, because nothing else does either."],
            ].map(([phase, title, state, body]) => (
              <div key={phase} className="bg-void px-5 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash">
                    {phase} — <span className="text-bone">{title}</span>
                  </dt>
                  <span
                    className={`font-mono text-[0.65rem] uppercase tracking-[0.18em] ${
                      state === "Complete" ? "text-ember" : "text-ash/70"
                    }`}
                  >
                    {state}
                  </span>
                </div>
                <dd className="mt-2 text-sm leading-relaxed text-ash">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <EmberRule />

      {/* ---------------------------------------------------------------- *
          Call to action
       * ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-28 text-center sm:px-8">
        <h2 className="display mx-auto max-w-3xl text-[clamp(2rem,6vw,3.75rem)] text-bone">
          The fire already happened.
          <br />
          <span className="text-ash-bright">You are what comes after.</span>
        </h2>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          <Link href="/register" className="btn btn-ember">
            Create an account
          </Link>
          <Link href="/play" className="btn">
            Connect a client
          </Link>
        </div>

        <p className="mt-10 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash/70">
          3.3.5a · build 12340 · bring your own client
        </p>
      </section>
    </>
  );
}
