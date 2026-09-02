import { PromoteButtons, StageForm } from "@/components/ItemControls";
import { PageHeader } from "@/components/Shell";
import { requirePermission } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { describeAllowableClass, itemizationSummary, listStaged, searchItems } from "@/lib/items";
import { can } from "@/lib/roles";
import { qualityColour } from "@shared/wow";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; only?: string; page?: string; stage?: string; notice?: string; entry?: string }>;
}) {
  const { actor } = await requirePermission("item.view");
  const params = await searchParams;

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const only = (["all", "restricted", "staged"] as const).find((value) => value === params.only) ?? "all";

  const [summary, items, staged] = await Promise.all([
    itemizationSummary(),
    searchItems({ q: params.q, only, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listStaged("staged", 50),
  ]);

  const stageTarget = params.stage
    ? items.rows.find((item) => item.entry === Number.parseInt(params.stage ?? "", 10))
    : undefined;

  return (
    <>
      <PageHeader
        title="Itemization"
        description="Class restrictions on weapons and armour, and the staged changes to them."
      />

      {/* Carried in the URL because the row that triggered it has unmounted. */}
      {params.notice === "promoted" ? (
        <p className="notice notice-ok mb-4" role="status">
          Applied to item {params.entry ?? "—"}. The worldserver caches item templates, so it reaches players
          after a <span className="mono">reload item_template</span> or a restart.
        </p>
      ) : params.notice === "withdrawn" ? (
        <p className="notice mb-4" role="status">
          The staged change for item {params.entry ?? "—"} was withdrawn. Nothing reached the world database.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gear rows" value={summary.total.toLocaleString()} />
        <Stat label="Unrestricted" value={summary.unrestricted.toLocaleString()} />
        <Stat
          label="Still class-locked"
          value={summary.restricted.toLocaleString()}
          tone={summary.restricted > 0 ? "warn" : undefined}
        />
        <Stat label="Staged changes" value={String(summary.stagedCount)} />
      </div>

      <section className="panel mt-4 p-4 text-sm">
        <p>
          <span className="mono">AllowableClass</span> is a <em>signed</em> integer where{" "}
          <span className="mono">-1</span> means every class — not a bitmask with every bit set. It is also the{" "}
          <em>weaker</em> of the two gates on gear: armour proficiency is a skill granted by a spell and checked
          separately, and plate is sold only by Warrior and Paladin trainers, so clearing a mask does not hand a
          cloth-wearer plate. The proficiency ladder still holds.
        </p>
        <p className="muted mt-2">
          {summary.backupRows === null ? (
            <>
              <span className="mono">classless_item_class_backup</span> is missing, so the original values are
              not recoverable from the database. Nothing here can be reverted automatically.
            </>
          ) : (
            <>
              <span className="mono">classless_item_class_backup</span> holds{" "}
              {summary.backupRows.toLocaleString()} original values, so the Phase 3 pass is reversible.
            </>
          )}
        </p>
      </section>

      {staged.length > 0 ? (
        <section className="panel mt-4">
          <h2 className="panel-head">Staged, awaiting an owner</h2>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Change</th>
                <th>Staged by</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staged.map((change) => (
                <tr key={change.id}>
                  <td className="whitespace-nowrap">
                    {change.itemName ?? "—"} <span className="muted mono">#{change.itemEntry}</span>
                  </td>
                  <td className="mono whitespace-nowrap">
                    {describeAllowableClass(change.oldValue ?? -1)} → {describeAllowableClass(change.newValue)}
                  </td>
                  <td className="whitespace-nowrap">
                    {change.stagedBy}
                    <span className="muted block text-[0.6875rem]">{formatDateTime(change.stagedAt)}</span>
                  </td>
                  <td className="muted">{change.reason ?? "—"}</td>
                  <td>
                    {can(actor, "item.stage") ? (
                      <PromoteButtons id={change.id} canPromote={can(actor, "item.promote")} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {stageTarget && can(actor, "item.stage") ? (
        <section className="panel mt-4">
          <h2 className="panel-head">Stage a change</h2>
          <div className="p-4">
            <StageForm entry={stageTarget.entry} name={stageTarget.name} current={stageTarget.allowableClass} />
          </div>
        </section>
      ) : null}

      <form className="panel mb-4 mt-4 flex flex-wrap items-end gap-3 p-3" method="get">
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" className="field" defaultValue={params.q ?? ""} placeholder="item name or entry" />
        </div>
        <div>
          <label className="label" htmlFor="only">
            Show
          </label>
          <select id="only" name="only" className="field" defaultValue={only}>
            <option value="all">All gear</option>
            <option value="restricted">Still class-locked</option>
            <option value="staged">Has a staged change</option>
          </select>
        </div>
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>ilvl</th>
              <th>Req</th>
              <th>Allowed classes</th>
              <th>Originally</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No items match.
                </td>
              </tr>
            ) : (
              items.rows.map((item) => (
                <tr key={item.entry}>
                  <td>
                    <span style={{ color: qualityColour(item.quality) }}>{item.name}</span>
                    <span className="muted mono ml-2 text-[0.6875rem]">#{item.entry}</span>
                  </td>
                  <td className="mono">{item.itemLevel}</td>
                  <td className="mono">{item.requiredLevel}</td>
                  <td className={item.allowableClass === -1 ? "muted" : ""}>
                    {describeAllowableClass(item.allowableClass)}
                  </td>
                  <td className="muted">
                    {item.originalAllowableClass === null
                      ? "—"
                      : describeAllowableClass(item.originalAllowableClass)}
                  </td>
                  <td className="text-right">
                    {item.staged ? (
                      <span className="chip">Staged</span>
                    ) : can(actor, "item.stage") ? (
                      <a className="text-xs underline" href={stageHref(params, item.entry)}>
                        Stage a change
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {items.total > PAGE_SIZE ? (
        <nav className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 ? (
            <a className="btn" href={pageHref(params, page - 1)}>
              Previous
            </a>
          ) : null}
          <span className="muted">
            Page {page} of {Math.ceil(items.total / PAGE_SIZE)}
          </span>
          {page * PAGE_SIZE < items.total ? (
            <a className="btn" href={pageHref(params, page + 1)}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="panel p-4">
      <p className="label mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${tone === "warn" ? "text-[var(--color-warn)]" : ""}`}>{value}</p>
    </div>
  );
}

function query(params: Record<string, string | undefined>, extra: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // `notice` and `entry` describe the last action, not the current view, so
    // they are dropped from every link out of it.
    if (value && !(key in extra) && key !== "notice" && key !== "entry") search.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) search.set(key, value);
  return `/items?${search.toString()}`;
}

function pageHref(params: Record<string, string | undefined>, page: number): string {
  return query(params, { page: String(page) });
}

function stageHref(params: Record<string, string | undefined>, entry: number): string {
  return query(params, { stage: String(entry) });
}
