import Link from "next/link";
import { formatPlayed, formatRelative } from "@/lib/format";
import { chassisName, raceName } from "@/lib/wow";
import type { CharacterSummary } from "@/lib/types";

const FACTION_CLASS: Record<string, string> = {
  alliance: "text-alliance",
  horde: "text-horde",
  neutral: "text-ash",
};

export function CharacterCard({ character }: { character: CharacterSummary }) {
  return (
    <Link
      href={`/armory/${encodeURIComponent(character.name)}`}
      className="panel group block px-4 py-3.5 transition-colors hover:border-edge-warm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="display text-lg text-bone transition-colors group-hover:text-ember">
          {character.name}
        </span>
        <span className="numeric text-xs text-ash">{character.level}</span>
      </div>

      <p className="mt-1 text-xs text-ash">
        <span className={FACTION_CLASS[character.faction]}>{raceName(character.race)}</span>
        <span className="mx-1.5 text-edge">/</span>
        <span title="The chassis a character is built on - see the wiki">
          {chassisName(character.chassis)} chassis
        </span>
      </p>

      <p className="mt-2 flex items-center gap-2 text-[0.7rem] text-ash/80">
        {character.online ? (
          <>
            <span className="pulse pulse-live" aria-hidden="true" />
            <span className="text-ember">In the world</span>
          </>
        ) : (
          <span>Last seen {formatRelative(character.lastLogin)}</span>
        )}
      </p>

      {character.guildName ? (
        <p className="mt-1 truncate text-[0.7rem] text-ash/70">&lt;{character.guildName}&gt;</p>
      ) : (
        <p className="mt-1 text-[0.7rem] text-ash/50">{formatPlayed(character.playedSeconds)}</p>
      )}
    </Link>
  );
}
