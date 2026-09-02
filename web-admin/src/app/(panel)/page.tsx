import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { auditPulse, readAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/authz";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { realmStatus } from "@/lib/realm";
import { can } from "@/lib/roles";
import { listLiveSessions } from "@/lib/session";
import { soapAvailable } from "@/lib/soap";

export const dynamic = "force-dynamic";

/**
 * The overview.
 *
 * Deliberately not a wall of graphs. The three questions an operator opens this
 * page to answer are: is the realm up, has anything been refused, and who else
 * is in here. Everything on it answers one of those.
 */
export default async function OverviewPage() {
  const { actor, address } = await requirePermission("realm.view");

  const [status, pulse, sessions, recent] = await Promise.all([
    realmStatus(),
    auditPulse(24),
    can(actor, "admin.session.revoke") ? listLiveSessions(10) : Promise.resolve([]),
    readAudit({ limit: 12 }),
  ]);

  return (
    <>
      <PageHeader
        title={`Realm ${status.realm?.name ?? "—"}`}
        description={`Signed in as ${actor.username}. Everything you do here is recorded.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Players online" value={String(status.charactersOnline)} note={`${status.accountsOnline} accounts`} />
        <Stat
          label="Uptime"
          value={status.uptimeSeconds ? formatDuration(status.uptimeSeconds) : "—"}
          note={status.startedAt ? `since ${formatDateTime(status.startedAt)}` : "no uptime row yet"}
        />
        <Stat label="Characters" value={String(status.charactersTotal)} note={`${status.accountsTotal} accounts`} />
        <Stat
          label="Refused (24h)"
          value={String(pulse.denied)}
          note={`${pulse.total} actions logged`}
          tone={pulse.denied > 0 ? "warn" : undefined}
        />
      </div>

      {status.realm && status.realm.allowedSecurityLevel > 0 ? (
        <p className="notice notice-warn mt-4">
          Maintenance mode is on: only accounts at GM level {status.realm.allowedSecurityLevel} and above can log
          in. <Link href="/realm" className="underline">Change it</Link>.
        </p>
      ) : null}

      {address === null ? (
        <p className="notice mt-4">
          No client address can be determined, so the audit log records actions without one. That is expected
          on a private instance reached directly; behind a proxy, set{" "}
          <span className="mono">ADMIN_TRUSTED_PROXY_HOPS</span> or{" "}
          <span className="mono">ADMIN_REAL_IP_HEADER</span> so the log can say where an action came from.
        </p>
      ) : null}

      {!soapAvailable() ? (
        <p className="notice mt-4">
          The worldserver console is not configured, so actions that need a running server — kicks, revives,
          teleports, live MOTD — are unavailable. Database-backed actions still work.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <h2 className="panel-head">Recent activity</h2>
          <table className="grid-table">
            <tbody>
              {recent.rows.length === 0 ? (
                <tr>
                  <td className="muted">Nothing logged yet.</td>
                </tr>
              ) : (
                recent.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">
                      <span className="mono">{row.actorUsername ?? "—"}</span>
                    </td>
                    <td>
                      <span className={row.outcome === "denied" ? "text-[var(--color-danger)]" : ""}>
                        {row.action}
                      </span>
                      {row.targetLabel ? <span className="muted"> → {row.targetLabel}</span> : null}
                    </td>
                    <td className="muted whitespace-nowrap text-right">{formatRelative(row.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="border-t border-[var(--color-edge)] px-4 py-2">
            <Link href="/audit" className="text-xs underline">
              Full audit log
            </Link>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-head">Staff signed in</h2>
          {sessions.length === 0 ? (
            <p className="muted p-4 text-sm">
              {can(actor, "admin.session.revoke")
                ? "No live sessions other than the ones being counted right now."
                : "Only an owner can see who else is signed in."}
            </p>
          ) : (
            <table className="grid-table">
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="mono whitespace-nowrap">{session.username}</td>
                    <td className="muted mono">{session.address ?? "—"}</td>
                    <td className="muted whitespace-nowrap text-right">{formatRelative(session.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "warn";
}) {
  return (
    <div className="panel p-4">
      <p className="label mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${tone === "warn" ? "text-[var(--color-warn)]" : ""}`}>{value}</p>
      {note ? <p className="muted mt-0.5 text-xs">{note}</p> : null}
    </div>
  );
}
