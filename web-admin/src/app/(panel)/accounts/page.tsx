import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { searchAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/authz";
import { formatRelative } from "@/lib/format";
import { maskEmail } from "@/lib/roles";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { actor } = await requirePermission("account.view");
  const params = await searchParams;

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const status = (["all", "banned", "online", "staff"] as const).find((value) => value === params.status) ?? "all";

  const { rows, total } = await searchAccounts({
    q: params.q,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Accounts" description={`${total.toLocaleString()} matching.`} />

      <form className="panel mb-4 flex flex-wrap items-end gap-3 p-3" method="get">
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" className="field" defaultValue={params.q ?? ""}
            placeholder="username, id, email or last IP" />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Filter
          </label>
          <select id="status" name="status" className="field" defaultValue={status}>
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="banned">Banned</option>
            <option value="staff">Staff</option>
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
              <th>Account</th>
              <th>Email</th>
              <th>Characters</th>
              <th>Last login</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No accounts match.
                </td>
              </tr>
            ) : (
              rows.map((account) => (
                <tr key={account.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/accounts/${account.id}`} className="mono underline">
                      {account.username}
                    </Link>
                    <span className="muted ml-2 text-[0.6875rem]">#{account.id}</span>
                  </td>
                  {/* maskEmail does the tiering itself: support sees enough to
                      confirm an address a player read out, not enough to harvest
                      the list. */}
                  <td className="mono muted">{maskEmail(account.email ?? "", actor)}</td>
                  <td>{account.characterCount}</td>
                  <td className="muted whitespace-nowrap">{formatRelative(account.lastLogin)}</td>
                  <td className="whitespace-nowrap">
                    {account.online ? <span className="chip mr-1">Online</span> : null}
                    {account.banned ? (
                      <span className="chip mr-1 border-[color-mix(in_srgb,var(--color-danger)_55%,transparent)] text-[var(--color-danger)]">
                        Banned
                      </span>
                    ) : null}
                    {account.role ? <span className="chip mr-1">{account.role}</span> : null}
                    {account.locked ? <span className="chip">IP-locked</span> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 ? (
            <a className="btn" href={`/accounts?${new URLSearchParams({ ...clean(params), page: String(page - 1) })}`}>
              Previous
            </a>
          ) : null}
          <span className="muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a className="btn" href={`/accounts?${new URLSearchParams({ ...clean(params), page: String(page + 1) })}`}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

function clean(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]) && entry[0] !== "page"),
  );
}
