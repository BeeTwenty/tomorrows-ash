import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BanPanel,
  GmLevelPanel,
  LockPanel,
  MutePanel,
  PasswordPanel,
} from "@/components/AccountActions";
import { PageHeader } from "@/components/Shell";
import { banHistory, getAccount } from "@/lib/accounts";
import { readAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/authz";
import { searchCharacters } from "@/lib/characters";
import { formatDateTime, formatRelative } from "@/lib/format";
import { can, canActOnAccount, maskEmail } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePermission("account.view");
  const { id } = await params;

  const accountId = Number.parseInt(id, 10);
  if (!Number.isInteger(accountId)) notFound();

  const account = await getAccount(accountId);
  if (!account) notFound();

  const [characters, bans, history] = await Promise.all([
    searchCharacters({ accountId: account.id, limit: 50 }),
    banHistory(account.id),
    // Everything ever done *to* this account, which is the question a support
    // ticket actually asks.
    readAudit({ targetType: "account", targetId: String(account.id), limit: 25 }),
  ]);

  /**
   * One verdict, computed once and used by every panel below.
   *
   * The server re-checks it inside each action - this is presentation. Showing
   * a form that will certainly be refused wastes the operator's time and
   * teaches them to expect refusals, which is how real refusals stop being
   * read.
   */
  const verdict = canActOnAccount(actor, account.gmLevel, account.id);

  return (
    <>
      <PageHeader
        title={account.username}
        description={`Account #${account.id} · joined ${formatDateTime(account.joinDate)}`}
      />

      {!verdict.allowed ? (
        <p className="notice notice-warn mb-4">{verdict.reason} You can read this page but not change it.</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-1">
          <h2 className="panel-head">Standing</h2>
          <dl className="space-y-2 p-4 text-sm">
            <Row label="Email" value={maskEmail(account.email ?? "", actor)} mono />
            <Row label="Last login" value={formatRelative(account.lastLogin)} />
            <Row label="Last address" value={account.lastIp ?? "—"} mono />
            <Row label="Online" value={account.online ? "Yes" : "No"} />
            <Row
              label="Staff level"
              value={account.gmLevel > 0 ? `${account.gmLevel} — ${account.role}` : "0 — player"}
            />
            <Row
              label="Ban"
              value={
                account.banned
                  ? account.banPermanent
                    ? `Permanent — ${account.banReason ?? "no reason"}`
                    : `Until ${formatDateTime(account.banExpires)} — ${account.banReason ?? "no reason"}`
                  : "None"
              }
            />
            <Row label="Mute" value={account.mutedUntil ? `Until ${formatDateTime(account.mutedUntil)}` : "None"} />
            <Row label="IP lock" value={account.locked ? "On" : "Off"} />
          </dl>
        </section>

        <section className="panel lg:col-span-2">
          <h2 className="panel-head">Characters ({characters.total})</h2>
          <table className="grid-table">
            <tbody>
              {characters.rows.length === 0 ? (
                <tr>
                  <td className="muted">No characters.</td>
                </tr>
              ) : (
                characters.rows.map((character) => (
                  <tr key={character.guid}>
                    <td className="whitespace-nowrap">
                      <Link href={`/characters/${character.guid}`} className="underline">
                        {character.name}
                      </Link>
                    </td>
                    <td className="muted whitespace-nowrap">
                      {character.level} {character.raceName} {character.chassisName}
                    </td>
                    <td className="muted">{character.zoneName}</td>
                    <td className="text-right">
                      {character.online ? <span className="chip">Online</span> : null}
                      {character.banned ? <span className="chip ml-1">Banned</span> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>

      {verdict.allowed ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {can(actor, "account.ban") ? (
            <section className="panel">
              <h2 className="panel-head">{account.banned ? "Ban in force" : "Ban"}</h2>
              <div className="p-4">
                <BanPanel accountId={account.id} username={account.username} banned={account.banned} />
              </div>
            </section>
          ) : null}

          {can(actor, "account.mute") ? (
            <section className="panel">
              <h2 className="panel-head">Mute</h2>
              <div className="p-4">
                <MutePanel accountId={account.id} muted={Boolean(account.mutedUntil)} />
              </div>
            </section>
          ) : null}

          {can(actor, "account.password_reset") ? (
            <section className="panel">
              <h2 className="panel-head">Password</h2>
              <div className="p-4">
                <PasswordPanel accountId={account.id} username={account.username} />
              </div>
            </section>
          ) : null}

          {can(actor, "account.ban") ? (
            <section className="panel">
              <h2 className="panel-head">IP lock</h2>
              <div className="p-4">
                <LockPanel accountId={account.id} locked={account.locked} />
              </div>
            </section>
          ) : null}

          {can(actor, "account.set_gmlevel") ? (
            <section className="panel lg:col-span-2">
              <h2 className="panel-head">Staff level</h2>
              <div className="p-4">
                <GmLevelPanel
                  accountId={account.id}
                  username={account.username}
                  currentLevel={account.gmLevel}
                  actorLevel={actor.gmLevel}
                />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <h2 className="panel-head">Ban history</h2>
          <table className="grid-table">
            <tbody>
              {bans.length === 0 ? (
                <tr>
                  <td className="muted">Never banned.</td>
                </tr>
              ) : (
                bans.map((ban) => (
                  <tr key={ban.bandate.getTime()}>
                    <td className="mono muted whitespace-nowrap">{formatDateTime(ban.bandate)}</td>
                    <td>
                      {ban.reason}
                      <span className="muted block text-[0.6875rem]">
                        by {ban.bannedBy} · {ban.permanent ? "permanent" : `until ${formatDateTime(ban.unbandate)}`}
                        {ban.active ? "" : " · lifted"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2 className="panel-head">What staff have done here</h2>
          <table className="grid-table">
            <tbody>
              {history.rows.length === 0 ? (
                <tr>
                  <td className="muted">Nothing recorded against this account.</td>
                </tr>
              ) : (
                history.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono muted whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                    <td>
                      <span className={row.outcome === "denied" ? "text-[var(--color-danger)]" : ""}>
                        {row.action}
                      </span>
                      <span className="muted"> by {row.actorUsername ?? "—"}</span>
                      {row.reason ? <span className="muted block text-[0.6875rem]">{row.reason}</span> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="muted shrink-0">{label}</dt>
      <dd className={`text-right ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}
