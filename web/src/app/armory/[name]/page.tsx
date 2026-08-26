import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildDisplay } from "@/components/BuildDisplay";
import { EmberRule } from "@/components/EmberRule";
import { StatTile } from "@/components/StatTile";
import { getCharacterProfile } from "@/lib/armory";
import { formatNumber, formatPlayed, formatRelative } from "@/lib/format";
import { CHASSIS_TRAITS, chassisName, genderName, qualityColour, raceName, zoneName } from "@/lib/wow";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { name } = await params;
  const profile = await getCharacterProfile(decodeURIComponent(name));
  if (!profile) return { title: "Character not found" };

  const build =
    profile.build.mode === "classless"
      ? `${profile.build.archetype.title} — ${profile.build.archetype.descriptor}`
      : `${chassisName(profile.chassis)} chassis`;

  return {
    title: profile.name,
    description: `Level ${profile.level} ${raceName(profile.race)}. ${build}. On realm Ashmorrow.`,
  };
}

export default async function CharacterPage({ params }: Params) {
  const { name } = await params;
  const profile = await getCharacterProfile(decodeURIComponent(name));
  if (!profile) notFound();

  const factionClass =
    profile.faction === "alliance" ? "text-alliance" : profile.faction === "horde" ? "text-horde" : "text-ash";

  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <Link href="/armory" className="eyebrow transition-colors hover:text-ember">
        ← Armory
      </Link>

      {/* Identity */}
      <header className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="display text-5xl text-bone sm:text-6xl">{profile.name}</h1>
          <p className="mt-3 text-sm text-ash">
            Level {profile.level}{" "}
            <span className={factionClass}>
              {genderName(profile.gender)} {raceName(profile.race)}
            </span>
            {profile.guildName ? <span className="text-ash"> · &lt;{profile.guildName}&gt;</span> : null}
          </p>
        </div>

        <p className="flex items-center gap-2.5 font-mono text-[0.7rem] uppercase tracking-[0.18em]">
          {profile.online ? (
            <>
              <span className="pulse pulse-live" aria-hidden="true" />
              <span className="text-ember">In the world</span>
            </>
          ) : (
            <span className="text-ash">Last seen {formatRelative(profile.lastLogin)}</span>
          )}
        </p>
      </header>

      {/* The build - the reason this page exists */}
      <div className="mt-10">
        <BuildDisplay build={profile.build} />
      </div>

      {/* The chassis, explained rather than assumed */}
      <section className="panel mt-4 px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="eyebrow">Chassis</p>
          <Link href="/docs/chassis" className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ash transition-colors hover:text-ember">
            Why this still matters →
          </Link>
        </div>
        <p className="display mt-3 text-2xl text-bone">{chassisName(profile.chassis)}</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ash">
          {CHASSIS_TRAITS[profile.chassis] ?? "The frame this character is built on."}
        </p>
      </section>

      <EmberRule className="my-12" />

      {/* Record */}
      <section>
        <p className="eyebrow">Record</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Time played" value={formatPlayed(profile.playedSeconds).replace(/ played$/, "")} sub="in the world" />
          <StatTile label="Honourable kills" value={formatNumber(profile.totalKills)} sub={`${formatNumber(profile.honorPoints)} honour`} />
          <StatTile
            label="Achievements"
            value={profile.achievements === null ? "—" : formatNumber(profile.achievements)}
            sub="earned"
          />
          <StatTile label="Last seen in" value={zoneName(profile.zone)} sub={`zone ${profile.zone}`} />
        </div>
      </section>

      {/* Stats */}
      {profile.stats ? (
        <section className="mt-12">
          <p className="eyebrow">Attributes</p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ash/70">
            Recorded at the character&rsquo;s last logout, which is the only moment the realm writes them
            down.
          </p>

          <div className="mt-5 grid gap-px border border-edge bg-edge sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Health" value={formatNumber(profile.stats.maxHealth)} />
            <Stat label={profile.stats.primaryPowerName} value={formatNumber(profile.stats.primaryPowerMax)} />
            <Stat label="Armour" value={formatNumber(profile.stats.armor)} />
            <Stat label="Resilience" value={formatNumber(profile.stats.resilience)} />
            <Stat label="Strength" value={formatNumber(profile.stats.strength)} />
            <Stat label="Agility" value={formatNumber(profile.stats.agility)} />
            <Stat label="Stamina" value={formatNumber(profile.stats.stamina)} />
            <Stat label="Intellect" value={formatNumber(profile.stats.intellect)} />
            <Stat label="Spirit" value={formatNumber(profile.stats.spirit)} />
            <Stat label="Attack power" value={formatNumber(profile.stats.attackPower)} />
            <Stat label="Spell power" value={formatNumber(profile.stats.spellPower)} />
            <Stat label="Crit" value={`${profile.stats.critPct.toFixed(1)}%`} />
            <Stat label="Spell crit" value={`${profile.stats.spellCritPct.toFixed(1)}%`} />
            <Stat label="Dodge" value={`${profile.stats.dodgePct.toFixed(1)}%`} />
            <Stat label="Parry" value={`${profile.stats.parryPct.toFixed(1)}%`} />
            <Stat label="Block" value={`${profile.stats.blockPct.toFixed(1)}%`} />
          </div>
        </section>
      ) : null}

      {/* Gear */}
      {profile.gear.length > 0 ? (
        <section className="mt-12">
          <p className="eyebrow">Equipped</p>
          <ul className="mt-5 grid gap-px border border-edge bg-edge sm:grid-cols-2">
            {profile.gear.map((item) => (
              <li key={`${item.slot}-${item.entry}`} className="flex items-baseline justify-between gap-4 bg-void px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm" style={{ color: qualityColour(item.quality) }}>
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.14em] text-ash/70">{item.label}</p>
                </div>
                <span className="numeric flex-none text-xs text-ash">{item.itemLevel}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 bg-void px-4 py-3">
      <span className="text-xs uppercase tracking-[0.14em] text-ash">{label}</span>
      <span className="numeric text-sm text-bone">{value}</span>
    </div>
  );
}
