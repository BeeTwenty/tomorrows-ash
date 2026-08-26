import type { Metadata } from "next";
import { CharacterCard } from "@/components/CharacterCard";
import { EmberRule } from "@/components/EmberRule";
import { getOnlineCharacters, searchCharacters } from "@/lib/armory";
import { classlessTablesPresent } from "@/lib/build";
import { isDemo } from "@/lib/env";
import { pluralise } from "@/lib/format";
import { RATE_RULES, consume, rateLimitMessage } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Armory",
  description: "Look up a character on Ashmorrow and read the build they actually committed to.",
};

export default async function ArmoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").slice(0, 32);

  let results = null;
  let limited: string | null = null;

  if (term.trim()) {
    // Search is cheap but unbounded, so it gets its own budget per address.
    const verdict = await consume(`armory:${await clientAddress()}`, RATE_RULES.armorySearch);
    if (verdict.allowed) {
      results = await searchCharacters(term);
    } else {
      limited = rateLimitMessage(verdict);
    }
  }

  const [online, classlessLive] = await Promise.all([
    getOnlineCharacters(12),
    isDemo ? Promise.resolve(true) : classlessTablesPresent(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="eyebrow">Armory</p>
      <h1 className="display mt-6 max-w-2xl text-5xl text-bone sm:text-6xl">
        Every character is an argument.
      </h1>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-ash">
        There is no class to look up here. Search a name and you get the case that character has been
        making — which trees they committed to, how deep, and what that adds up to.
      </p>

      <form method="get" className="mt-10 flex max-w-xl flex-wrap gap-3" role="search">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Character name"
          aria-label="Character name"
          maxLength={32}
          minLength={2}
          spellCheck={false}
          className="field flex-1 min-w-[12rem]"
        />
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      {!classlessLive && !isDemo ? (
        <p className="mt-6 max-w-xl border-l-2 border-edge-warm bg-smoke/60 px-4 py-3 text-xs leading-relaxed text-ash">
          The classless system is not live on this realm yet, so profiles show the chassis and what the
          stock database records rather than ability trees.
        </p>
      ) : null}

      {limited ? (
        <p className="mt-8 border-l-2 border-ember-dim bg-ember/5 px-4 py-3 text-sm text-bone">{limited}</p>
      ) : null}

      {results !== null ? (
        <section className="mt-12">
          <p className="eyebrow">
            {results.length > 0 ? pluralise(results.length, "match", "matches") : "No matches"}
            {results.length >= 25 ? " (showing the first 25)" : ""}
          </p>

          {results.length > 0 ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((character) => (
                <CharacterCard key={character.guid} character={character} />
              ))}
            </div>
          ) : (
            <p className="mt-4 max-w-lg text-sm text-ash">
              Nothing on {`"${term}"`}. Character names are matched from the start, so try the first few
              letters. A character has to have logged in at least once to appear here.
            </p>
          )}
        </section>
      ) : null}

      {online.length > 0 ? (
        <>
          <EmberRule className="my-14" />
          <section>
            <p className="eyebrow">In the world right now</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {online.map((character) => (
                <CharacterCard key={character.guid} character={character} />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
