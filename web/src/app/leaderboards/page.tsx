import type { Metadata } from "next";
import Link from "next/link";
import { getLeaderboards } from "@/lib/leaderboards";
import { isDemo } from "@/lib/env";
import { chassisName, raceName } from "@/lib/wow";
import type { Leaderboard } from "@/lib/types";

/**
 * Never prerendered. This page reads the realm database and the realm's
 * configuration, both of which belong to the *running* deployment - a build
 * that happened on another machine, or in a container with no database, must
 * not be able to bake its answers into the output. Load is handled by the
 * cache inside the data layer instead.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rankings",
  description: "Who has gone furthest, fought most, and committed deepest on Ashmorrow.",
};

export default async function LeaderboardsPage() {
  const boards = await getLeaderboards();

  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="eyebrow">Rankings</p>
      <h1 className="display mt-6 max-w-2xl text-5xl text-bone sm:text-6xl">
        Nobody here is ranked by class.
      </h1>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-ash">
        On a realm with no classes, the interesting ladder is not who has the best gear for their spec.
        It is who has gone furthest, who has fought most, and who has committed hardest to one shape.
      </p>

      {isDemo ? (
        <p className="mt-8 max-w-xl border-l-2 border-edge-warm bg-smoke/60 px-4 py-3 text-xs leading-relaxed text-ash">
          <strong className="text-ash-bright">Demo mode.</strong> These standings are illustrative.
        </p>
      ) : null}

      <div className="mt-14 grid gap-10 lg:grid-cols-2">
        {boards.map((board) => (
          <BoardTable key={board.key} board={board} />
        ))}
      </div>
    </div>
  );
}

function BoardTable({ board }: { board: Leaderboard }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="display text-2xl text-bone">{board.title}</h2>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ash/80">{board.blurb}</p>

      {board.unavailable ? (
        <p className="panel mt-4 px-4 py-4 text-sm leading-relaxed text-ash">{board.unavailable}</p>
      ) : board.entries.length === 0 ? (
        <p className="panel mt-4 px-4 py-4 text-sm text-ash">
          Nothing to rank yet. This board fills in as characters play.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-edge border border-edge">
          {board.entries.map((entry) => (
            <li key={`${board.key}-${entry.rank}-${entry.name}`} className="flex items-center gap-4 bg-void px-4 py-2.5">
              <span className="numeric w-6 flex-none text-xs text-ash/60">{entry.rank}</span>

              <div className="min-w-0 flex-1">
                {entry.guid !== null ? (
                  <Link
                    href={`/armory/${encodeURIComponent(entry.name)}`}
                    className="truncate text-sm text-bone transition-colors hover:text-ember"
                  >
                    {entry.name}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-bone">{entry.name}</span>
                )}
                <p className="truncate text-[0.7rem] text-ash/70">
                  {entry.race !== null && entry.chassis !== null
                    ? `${raceName(entry.race)} · ${chassisName(entry.chassis)} chassis`
                    : null}
                  {entry.sub ? (entry.race !== null ? ` · ${entry.sub}` : entry.sub) : null}
                </p>
              </div>

              <span className="numeric flex-none text-xs text-ash-bright">{entry.display}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
