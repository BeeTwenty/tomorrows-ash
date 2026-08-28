import { formatNumber, formatPercent } from "@/lib/format";
import type { CharacterBuild } from "@/lib/types";

/**
 * How a character with no class is described.
 *
 * A normal armory prints "Fire Mage" and stops. Here the identity has to be
 * shown rather than named, so this renders three things in descending order of
 * usefulness:
 *
 *   1. the derived archetype - a title argued for by the numbers below it;
 *   2. the spend bar - the whole build in one glance, proportional and
 *      colour-keyed;
 *   3. the trees themselves, with each node's rank as filled pips.
 *
 * When the classless system is not live, none of that is invented: the panel
 * says so and falls back to what the stock database actually knows.
 */
export function BuildDisplay({ build }: { build: CharacterBuild }) {
  if (build.mode === "interim") {
    return (
      <section className="panel px-5 py-5 sm:px-6">
        <p className="eyebrow">The build</p>
        <p className="display mt-3 text-2xl text-ash-bright">Not yet written</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ash">{build.note}</p>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="border-l border-edge pl-4">
            <dt className="eyebrow text-[0.625rem]">Talents recorded</dt>
            <dd className="numeric mt-1 text-xl text-bone">
              {build.talentsRecorded === null ? "—" : formatNumber(build.talentsRecorded)}
            </dd>
          </div>
          <div className="border-l border-edge pl-4">
            <dt className="eyebrow text-[0.625rem]">Abilities known</dt>
            <dd className="numeric mt-1 text-xl text-bone">
              {build.abilitiesKnown === null ? "—" : formatNumber(build.abilitiesKnown)}
            </dd>
          </div>
        </dl>

        <p className="mt-6 text-xs text-ash/70">
          Ability trees, skill points and respecs arrive with the classless system. Until then this
          realm runs stock rules and this panel stays honest about it.
        </p>
      </section>
    );
  }

  const { archetype, trees, pointsSpent, pointsTotal } = build;

  // Every segment of the spend bar is measured against the same budget, so a
  // realm whose recorded total disagrees with the itemised spend still renders
  // a bar that adds up instead of overflowing its row.
  const budget = Math.max(pointsTotal ?? pointsSpent, pointsSpent, 1);
  const unspent = pointsTotal === null ? null : Math.max(0, budget - pointsSpent);

  return (
    <section className="panel panel-warm px-5 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">The build</p>
          <h2 className="display mt-2 text-4xl text-bone sm:text-5xl">{archetype.title}</h2>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-ember">
            {archetype.descriptor}
          </p>
        </div>

        <div className="text-right">
          <p className="numeric text-3xl leading-none text-bone">{formatNumber(pointsSpent)}</p>
          <p className="mt-1 text-xs text-ash">
            points spent
            {pointsTotal !== null ? ` of ${formatNumber(pointsTotal)}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ash-bright">{archetype.summary}</p>

      {/* The whole build as one proportional bar. */}
      <div className="mt-6">
        <div className="flex h-2 w-full overflow-hidden rounded-[1px] bg-smoke" role="presentation">
          {trees.map((tree) => (
            <div
              key={tree.id}
              style={{ width: `${(tree.points / budget) * 100}%`, backgroundColor: tree.colour }}
              className="h-full"
            />
          ))}
          {unspent !== null && unspent > 0 ? (
            <div style={{ width: `${(unspent / budget) * 100}%` }} className="h-full bg-edge" />
          ) : null}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {trees.map((tree) => (
            <li key={tree.id} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 flex-none rounded-[1px]"
                style={{ backgroundColor: tree.colour }}
                aria-hidden="true"
              />
              <span className="text-bone">{tree.name}</span>
              <span className="numeric text-ash">{tree.points}</span>
              <span className="text-ash/60">{formatPercent(tree.share)}</span>
            </li>
          ))}
          {unspent !== null && unspent > 0 ? (
            <li className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 flex-none rounded-[1px] bg-edge" aria-hidden="true" />
              <span className="text-ash">Unspent</span>
              <span className="numeric text-ash">{unspent}</span>
            </li>
          ) : null}
        </ul>
      </div>

      {/* The trees themselves. */}
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {trees.map((tree) => (
          <div key={tree.id} className="border-t border-edge pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-bone">
                <span
                  className="h-3 w-[2px] flex-none"
                  style={{ backgroundColor: tree.colour }}
                  aria-hidden="true"
                />
                {tree.name}
              </h3>
              <span className="numeric text-xs text-ash">{tree.points} pts</span>
            </div>

            {tree.description ? (
              <p className="mt-1.5 text-xs leading-relaxed text-ash/80">{tree.description}</p>
            ) : null}

            <ul className="mt-3 space-y-1.5">
              {tree.nodes.map((node) => (
                <li key={node.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate text-ash-bright" title={node.description ?? undefined}>
                    <span className="numeric mr-2 text-ash/50">T{node.tier}</span>
                    {node.name}
                  </span>
                  <RankPips
                    rank={node.rank}
                    maxRank={node.maxRank}
                    colour={tree.colour}
                    granted={node.granted}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Rank shown as filled coals rather than "3/5", which reads faster in a list. */
function RankPips({
  rank,
  maxRank,
  colour,
  granted,
}: {
  rank: number;
  maxRank: number | null;
  colour: string;
  granted: boolean;
}) {
  // A node bought once has no rank to show and no max to show it against, so
  // "bought" beats a meaningless "rank 1" - and an ability the character
  // already had says so, because they did not pay for it.
  if (maxRank === null || maxRank <= 0 || maxRank > 8) {
    if (!granted) {
      return (
        <span className="flex-none text-ash/50" title="Already known - not sold to this character">
          already theirs
        </span>
      );
    }
    return rank <= 1 ? (
      <span className="flex-none text-ash/60">bought</span>
    ) : (
      <span className="numeric flex-none text-ash">rank {rank}</span>
    );
  }

  return (
    <span className="flex flex-none items-center gap-1" title={`Rank ${rank} of ${maxRank}`}>
      {Array.from({ length: maxRank }, (_, index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: index < rank ? colour : "var(--color-edge)",
          }}
        />
      ))}
    </span>
  );
}
