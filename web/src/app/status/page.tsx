import type { Metadata } from "next";
import Link from "next/link";
import { EmberRule } from "@/components/EmberRule";
import { StatTile } from "@/components/StatTile";
import { getRealmStatus } from "@/lib/realm";
import { env, isDemo } from "@/lib/env";
import { formatDate, formatDuration, formatNumber, formatRelative } from "@/lib/format";

/**
 * Never prerendered. This page reads the realm database and the realm's
 * configuration, both of which belong to the *running* deployment - a build
 * that happened on another machine, or in a container with no database, must
 * not be able to bake its answers into the output. Load is handled by the
 * cache inside the data layer instead.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Realm status",
  description: `Is ${env.realm.name} up? Population, uptime and how to connect.`,
};

export default async function StatusPage() {
  const status = await getRealmStatus();
  const total = Math.max(1, status.alliance + status.horde);

  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="eyebrow">Realm status</p>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <h1 className="display text-5xl text-bone sm:text-6xl">{status.name}</h1>
        <p className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em]">
          <span className={status.online ? "pulse pulse-live" : "pulse pulse-dead"} aria-hidden="true" />
          <span className={status.online ? "text-ember" : "text-ash"}>
            {status.online ? "Kindled" : "Dark"}
          </span>
        </p>
      </div>

      {status.degraded ? (
        <p className="mt-6 border-l-2 border-ember-dim bg-ember/5 px-4 py-3 text-sm text-ash-bright">
          {status.degraded}
        </p>
      ) : null}

      {isDemo ? (
        <p className="mt-6 border-l-2 border-edge-warm bg-smoke/60 px-4 py-3 text-sm text-ash">
          <strong className="text-ash-bright">Demo mode.</strong> No realm database is attached, so these
          numbers are illustrative rather than measured.
        </p>
      ) : null}

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="In the world"
          value={formatNumber(status.playersOnline)}
          sub={status.peakPlayers !== null ? `peak ${formatNumber(status.peakPlayers)} this run` : null}
          accent
        />
        <StatTile
          label="Uptime"
          value={formatDuration(status.uptimeSeconds)}
          sub={status.startedAt ? `since ${formatDate(status.startedAt)}` : "not currently running"}
        />
        <StatTile
          label="Characters"
          value={status.charactersTotal === null ? "—" : formatNumber(status.charactersTotal)}
          sub="written on this realm"
        />
        <StatTile
          label="Accounts"
          value={status.accountsTotal === null ? "—" : formatNumber(status.accountsTotal)}
          sub="registered"
        />
      </div>

      {/* Faction split */}
      <section className="panel mt-10 px-5 py-6 sm:px-6">
        <p className="eyebrow">Who is on right now</p>
        <div className="mt-5 flex h-2 w-full overflow-hidden rounded-[1px] bg-smoke">
          <div className="h-full bg-alliance" style={{ width: `${(status.alliance / total) * 100}%` }} />
          <div className="h-full bg-horde" style={{ width: `${(status.horde / total) * 100}%` }} />
        </div>
        <div className="mt-3 flex justify-between font-mono text-xs uppercase tracking-[0.18em]">
          <span className="text-alliance">Alliance {formatNumber(status.alliance)}</span>
          <span className="text-horde">{formatNumber(status.horde)} Horde</span>
        </div>
        {status.playersOnline === 0 ? (
          <p className="mt-4 text-sm text-ash">
            Nobody is in the world at the moment. That is not a fault — it is an early realm.
          </p>
        ) : null}
      </section>

      <EmberRule className="my-12" />

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Services */}
        <section>
          <p className="eyebrow">Services</p>
          <dl className="mt-5 space-y-px border border-edge bg-edge">
            <ServiceRow label="Login server" detail={`${status.address}:${status.authPort}`} up={status.authOnline} />
            <ServiceRow label="World server" detail={`${status.address}:${status.worldPort}`} up={status.worldOnline} />
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-ash/80">
            Both services are probed directly over TCP. A login server that answers while the world
            server does not usually means the realm is restarting — you will be able to log in but the
            realm will show as offline in the character screen.
          </p>
        </section>

        {/* Connecting */}
        <section>
          <p className="eyebrow">Connect</p>
          <div className="panel mt-5 px-5 py-5">
            <p className="text-sm text-ash">
              Set this in <code className="text-ember">realmlist.wtf</code> inside your 3.3.5a client:
            </p>
            <pre className="scroll-x mt-3 border border-edge bg-void px-4 py-3">
              <code className="numeric text-sm text-bone">set realmlist {status.address}</code>
            </pre>
            <p className="mt-4 text-xs text-ash/80">
              Client build 12340. You supply your own client — we distribute no Blizzard files.
            </p>
            <Link href="/play" className="btn mt-5 !px-4 !py-2 !text-[0.65rem]">
              Full connection guide
            </Link>
          </div>
        </section>
      </div>

      <p className="mt-12 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash/60">
        Checked {formatRelative(status.checkedAt)}
        {status.revision ? ` · ${status.revision}` : ""} · cached for {env.realm.statusCacheSeconds}s ·{" "}
        <Link href="/api/status" className="transition-colors hover:text-ember">
          JSON
        </Link>
      </p>
    </div>
  );
}

function ServiceRow({ label, detail, up }: { label: string; detail: string; up: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-void px-4 py-3.5">
      <div>
        <dt className="text-sm text-bone">{label}</dt>
        <dd className="numeric mt-0.5 text-xs text-ash">{detail}</dd>
      </div>
      <span className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.18em]">
        <span className={up ? "pulse pulse-live" : "pulse pulse-dead"} aria-hidden="true" />
        <span className={up ? "text-ember" : "text-ash"}>{up ? "Up" : "Down"}</span>
      </span>
    </div>
  );
}
