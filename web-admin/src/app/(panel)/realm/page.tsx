import { AnnounceForm, MaintenanceForm, MotdForm } from "@/components/RealmControls";
import { PageHeader } from "@/components/Shell";
import { requirePermission } from "@/lib/authz";
import { formatDateTime, formatDuration } from "@/lib/format";
import { realmStatus, recentLogins } from "@/lib/realm";
import { can } from "@/lib/roles";
import { serverInfo, soapAvailable } from "@/lib/soap";

export const dynamic = "force-dynamic";

export default async function RealmPage() {
  const { actor } = await requirePermission("realm.view");

  const [status, info, logins] = await Promise.all([realmStatus(), serverInfo(), recentLogins(10)]);

  return (
    <>
      <PageHeader
        title="Realm"
        description={status.realm ? `${status.realm.name} · ${status.realm.address}:${status.realm.port}` : "No realmlist row."}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-1">
          <h2 className="panel-head">State</h2>
          <dl className="space-y-2 p-4 text-sm">
            <Row label="Players online" value={String(status.charactersOnline)} />
            <Row label="Accounts online" value={String(status.accountsOnline)} />
            <Row label="Uptime" value={status.uptimeSeconds ? formatDuration(status.uptimeSeconds) : "—"} />
            <Row label="Started" value={formatDateTime(status.startedAt)} />
            <Row label="Peak" value={status.maxPlayersSeen !== null ? String(status.maxPlayersSeen) : "—"} />
            <Row label="Revision" value={status.revision ?? info?.revision ?? "—"} />
            <Row label="Build" value={String(status.realm?.gamebuild ?? "—")} />
            <Row
              label="Maintenance"
              value={
                status.realm && status.realm.allowedSecurityLevel > 0
                  ? `On — level ${status.realm.allowedSecurityLevel}+`
                  : "Off"
              }
            />
            <Row label="Console" value={soapAvailable() ? (info ? "reachable" : "configured, not answering") : "not configured"} />
          </dl>
        </section>

        <section className="panel lg:col-span-2">
          <h2 className="panel-head">Message of the day</h2>
          <div className="p-4">
            {can(actor, "realm.motd") ? (
              <MotdForm motd={status.motd ?? ""} />
            ) : (
              <p className="text-sm">{status.motd ?? <span className="muted">Not set.</span>}</p>
            )}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {can(actor, "realm.maintenance") ? (
          <section className="panel">
            <h2 className="panel-head">Maintenance</h2>
            <div className="p-4">
              <MaintenanceForm level={status.realm?.allowedSecurityLevel ?? 0} />
            </div>
          </section>
        ) : null}

        {can(actor, "realm.announce") ? (
          <section className="panel">
            <h2 className="panel-head">Announce</h2>
            <div className="p-4">
              <AnnounceForm soapReady={soapAvailable()} />
            </div>
          </section>
        ) : null}
      </div>

      <section className="panel mt-4">
        <h2 className="panel-head">Population cap</h2>
        <p className="muted p-4 text-sm">
          There is no field for it here, and that is deliberate.{" "}
          <span className="mono">PlayerLimit</span> lives in <span className="mono">worldserver.conf</span> and
          has no database representation — the panel could write a number somewhere and it would change nothing.
          Change it in the file and restart, or use maintenance mode above, which does take effect immediately.
        </p>
      </section>

      <section className="panel mt-4">
        <h2 className="panel-head">Recent logins</h2>
        <table className="grid-table">
          <tbody>
            {logins.length === 0 ? (
              <tr>
                <td className="muted">Nobody has logged in yet.</td>
              </tr>
            ) : (
              logins.map((login) => (
                <tr key={login.accountId}>
                  <td className="mono whitespace-nowrap">{login.username}</td>
                  <td className="muted mono">{login.lastIp ?? "—"}</td>
                  <td className="muted whitespace-nowrap text-right">{formatDateTime(login.lastLogin)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="muted shrink-0">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
