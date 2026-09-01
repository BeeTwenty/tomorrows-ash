import Link from "next/link";
import { notFound } from "next/navigation";
import { AtLoginPanel, ConsolePanel, EditPanel } from "@/components/CharacterActions";
import { PageHeader } from "@/components/Shell";
import { getAccount } from "@/lib/accounts";
import { readAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/authz";
import { equippedItems, getCharacter, teleportDestinations } from "@/lib/characters";
import { clamp, formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { can, canActOnAccount } from "@/lib/roles";
import { soapAvailable } from "@/lib/soap";
import { characterBuild } from "@/lib/trees";
import { EQUIPMENT_SLOT_LABELS, qualityColour } from "@shared/wow";

export const dynamic = "force-dynamic";

export default async function CharacterPage({ params }: { params: Promise<{ guid: string }> }) {
  const { actor } = await requirePermission("character.view");
  const { guid: raw } = await params;

  const guid = Number.parseInt(raw, 10);
  if (!Number.isInteger(guid)) notFound();

  const character = await getCharacter(guid);
  if (!character) notFound();

  const [owner, items, build, history, destinations] = await Promise.all([
    getAccount(character.accountId),
    equippedItems(character.guid),
    characterBuild(character.guid, character.level),
    readAudit({ targetType: "character", targetId: String(character.guid), limit: 20 }),
    can(actor, "character.teleport") && soapAvailable() ? teleportDestinations("", 60) : Promise.resolve([]),
  ]);

  // Authorised against the owning account, not the character: otherwise a GM
  // could be reached through the level 80 they play on.
  const verdict = canActOnAccount(actor, owner?.gmLevel ?? 0, character.accountId);

  return (
    <>
      <PageHeader
        title={character.name}
        description={`${character.level} ${character.raceName} ${character.chassisName} · guid ${character.guid}`}
      />

      {character.online ? (
        <p className="notice notice-warn mb-4">
          {character.name} is online. Direct edits are refused while the worldserver owns their data; console
          actions still work.
        </p>
      ) : null}
      {!verdict.allowed ? <p className="notice notice-warn mb-4">{verdict.reason}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel">
          <h2 className="panel-head">Character</h2>
          <dl className="space-y-2 p-4 text-sm">
            <Row label="Account" value={owner?.username ?? `#${character.accountId}`} href={`/accounts/${character.accountId}`} />
            <Row label="Faction" value={character.faction} />
            <Row label="Gender" value={character.gender} />
            <Row label="Gold" value={(character.money / 10_000).toFixed(2)} />
            <Row label="Zone" value={character.zoneName} />
            <Row label="Played" value={formatDuration(character.totalTime)} />
            <Row label="Last seen" value={character.online ? "online now" : formatRelative(character.logoutTime)} />
            {character.deleted ? <Row label="Deleted" value="Yes" /> : null}
            {character.banned ? <Row label="Banned" value="Yes" /> : null}
          </dl>
        </section>

        <section className="panel lg:col-span-2">
          <h2 className="panel-head">Equipped</h2>
          {items.length === 0 ? (
            <p className="muted p-4 text-sm">Nothing equipped.</p>
          ) : (
            <table className="grid-table">
              <tbody>
                {items.map((item) => (
                  <tr key={item.slot}>
                    <td className="muted whitespace-nowrap">{EQUIPMENT_SLOT_LABELS[item.slot] ?? `slot ${item.slot}`}</td>
                    <td>
                      <span style={{ color: qualityColour(item.quality ?? 1) }}>
                        {item.name ?? `item ${item.itemEntry}`}
                      </span>
                    </td>
                    <td className="muted mono whitespace-nowrap text-right">
                      {item.itemLevel ? `ilvl ${item.itemLevel}` : ""} #{item.itemEntry}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel mt-4">
        <h2 className="panel-head">Classless build</h2>
        {!build.live ? (
          <p className="muted p-4 text-sm">
            The classless module&rsquo;s tables are not present on this realm yet, so there is nothing to show.
          </p>
        ) : build.purchases.length === 0 ? (
          <p className="muted p-4 text-sm">{character.name} has not bought anything yet.</p>
        ) : (
          <>
            <p className="p-4 pb-0 text-sm">
              <span className="mono text-base">{build.spent}</span> points spent
              {build.budget !== null ? (
                <>
                  {" "}
                  of <span className="mono text-base">{build.budget}</span> at level {character.level}
                  <span className="muted"> ({build.budget - build.spent} unspent)</span>
                </>
              ) : (
                <span className="muted">
                  {" "}
                  — the budget curve is not published to the database, so the total available is unknown here.
                </span>
              )}
            </p>
            <table className="grid-table mt-3">
              <thead>
                <tr>
                  <th>Tree</th>
                  <th>Node</th>
                  <th>Spell</th>
                  <th>Paid</th>
                  <th>Bought</th>
                </tr>
              </thead>
              <tbody>
                {build.purchases.map((purchase) => (
                  <tr key={purchase.nodeId}>
                    <td className="muted whitespace-nowrap">{purchase.treeName}</td>
                    <td>{purchase.nodeName}</td>
                    <td className="mono muted">{purchase.spellId}</td>
                    <td className="mono">
                      {purchase.costPaid}
                      {!purchase.granted ? <span className="muted"> (already knew it)</span> : null}
                    </td>
                    <td className="muted whitespace-nowrap">{formatRelative(purchase.learnedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {verdict.allowed ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {can(actor, "character.edit") ? (
            <>
              <section className="panel">
                <h2 className="panel-head">Edit</h2>
                <div className="p-4">
                  <EditPanel
                    guid={character.guid}
                    level={character.level}
                    money={character.money}
                    online={character.online}
                  />
                </div>
              </section>

              <section className="panel">
                <h2 className="panel-head">Next login</h2>
                <div className="p-4">
                  <AtLoginPanel guid={character.guid} />
                </div>
              </section>
            </>
          ) : null}

          {can(actor, "character.kick") || can(actor, "character.revive") || can(actor, "character.teleport") ? (
            <section className="panel lg:col-span-2">
              <h2 className="panel-head">Console</h2>
              <div className="p-4">
                <ConsolePanel
                  guid={character.guid}
                  name={character.name}
                  online={character.online}
                  destinations={destinations}
                  canKick={can(actor, "character.kick")}
                  canRevive={can(actor, "character.revive")}
                  canTeleport={can(actor, "character.teleport")}
                  soapReady={soapAvailable()}
                />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <section className="panel mt-4">
        <h2 className="panel-head">What staff have done here</h2>
        <table className="grid-table">
          <tbody>
            {history.rows.length === 0 ? (
              <tr>
                <td className="muted">Nothing recorded against this character.</td>
              </tr>
            ) : (
              history.rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono muted whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                  <td className="whitespace-nowrap">{row.actorUsername ?? "—"}</td>
                  <td>
                    <span className={row.outcome === "denied" ? "text-[var(--color-danger)]" : ""}>{row.action}</span>
                    {row.summary ? <span className="muted block text-[0.6875rem]">{clamp(row.summary, 160)}</span> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="muted shrink-0">{label}</dt>
      <dd className="text-right">
        {href ? (
          <Link href={href} className="underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
