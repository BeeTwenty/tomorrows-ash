import { PageHeader } from "@/components/Shell";
import { readAudit, type AuditOutcome } from "@/lib/audit";
import { requirePermission } from "@/lib/authz";
import { clamp, formatDateTime } from "@/lib/format";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * The audit log.
 *
 * Support sees their own actions; anyone above sees everyone's. That split is
 * `audit.view.self` versus `audit.view.all`, and it is not about secrecy - it
 * is that a support account should not be able to study which of their
 * colleagues has been refused what, and when. Reading the whole log is a
 * supervisory act.
 */
const PAGE_SIZE = 60;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; outcome?: string; page?: string; actor?: string; target?: string }>;
}) {
  const { actor } = await requirePermission("audit.view.self");
  const params = await searchParams;

  const seesEverything = can(actor, "audit.view.all");
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const outcome = ["ok", "denied", "error"].includes(params.outcome ?? "")
    ? (params.outcome as AuditOutcome)
    : undefined;

  const { rows, total } = await readAudit({
    // The filter is applied server-side and cannot be widened from the query
    // string: a support account passing ?actor=3 still gets their own rows.
    actorAccountId: seesEverything
      ? params.actor
        ? Number.parseInt(params.actor, 10) || undefined
        : undefined
      : actor.accountId,
    q: params.q,
    outcome,
    targetId: params.target,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          seesEverything
            ? `${total.toLocaleString()} entries. Refusals are logged alongside successes.`
            : "Your own actions. Only an administrator can read the whole log."
        }
      />

      <form className="panel mb-4 flex flex-wrap items-end gap-3 p-3" method="get">
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            className="field"
            defaultValue={params.q ?? ""}
            placeholder="actor, target, reason or address"
          />
        </div>
        <div>
          <label className="label" htmlFor="outcome">
            Outcome
          </label>
          <select id="outcome" name="outcome" className="field" defaultValue={params.outcome ?? ""}>
            <option value="">Any</option>
            <option value="ok">Succeeded</option>
            <option value="denied">Refused</option>
            <option value="error">Failed</option>
          </select>
        </div>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Detail</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing matches.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono muted whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                  <td className="whitespace-nowrap">
                    <span className="mono">{row.actorUsername ?? "—"}</span>
                    {row.actorRole ? <span className="muted block text-[0.6875rem]">{row.actorRole}</span> : null}
                  </td>
                  <td className="whitespace-nowrap">
                    <span
                      className={
                        row.outcome === "denied"
                          ? "text-[var(--color-danger)]"
                          : row.outcome === "error"
                            ? "text-[var(--color-warn)]"
                            : ""
                      }
                    >
                      {row.action}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {row.targetLabel ?? row.targetId ?? "—"}
                    {row.targetType ? (
                      <span className="muted block text-[0.6875rem]">{row.targetType}</span>
                    ) : null}
                  </td>
                  <td className="max-w-md">
                    {row.summary ? <span>{clamp(row.summary, 160)}</span> : null}
                    {row.reason ? (
                      <span className="muted block text-[0.6875rem]">reason: {clamp(row.reason, 160)}</span>
                    ) : null}
                    {row.before || row.after ? (
                      <details className="mt-1">
                        <summary className="muted cursor-pointer text-[0.6875rem]">before / after</summary>
                        <pre className="mono mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-all text-[0.6875rem] text-[var(--color-ash-bright)]">
                          {row.before ? `- ${row.before}\n` : ""}
                          {row.after ? `+ ${row.after}` : ""}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                  <td className="mono muted whitespace-nowrap">{row.address ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 ? (
            <a className="btn" href={pageHref(params, page - 1)}>
              Newer
            </a>
          ) : null}
          <span className="muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a className="btn" href={pageHref(params, page + 1)}>
              Older
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

function pageHref(params: Record<string, string | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") query.set(key, value);
  }
  query.set("page", String(page));
  return `/audit?${query.toString()}`;
}
