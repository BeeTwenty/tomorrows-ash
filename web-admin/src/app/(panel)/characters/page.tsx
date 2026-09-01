import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { requirePermission } from "@/lib/authz";
import { searchCharacters } from "@/lib/characters";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requirePermission("character.view");
  const params = await searchParams;

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const status = (["all", "online", "banned", "deleted"] as const).find((value) => value === params.status) ?? "all";

  const { rows, total } = await searchCharacters({
    q: params.q,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Characters" description={`${total.toLocaleString()} matching.`} />

      <form className="panel mb-4 flex flex-wrap items-end gap-3 p-3" method="get">
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" className="field" defaultValue={params.q ?? ""}
            placeholder="character name, guid or account" />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Filter
          </label>
          <select id="status" name="status" className="field" defaultValue={status}>
            <option value="all">Live</option>
            <option value="online">Online</option>
            <option value="banned">Banned</option>
            <option value="deleted">Deleted</option>
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
              <th>Character</th>
              <th>Level</th>
              <th>Body</th>
              <th>Where</th>
              <th>Account</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No characters match.
                </td>
              </tr>
            ) : (
              rows.map((character) => (
                <tr key={character.guid}>
                  <td className="whitespace-nowrap">
                    <Link href={`/characters/${character.guid}`} className="underline">
                      {character.name}
                    </Link>
                    {character.online ? <span className="chip ml-2">Online</span> : null}
                    {character.deleted ? <span className="chip ml-2">Deleted</span> : null}
                  </td>
                  <td>{character.level}</td>
                  <td className="muted whitespace-nowrap">
                    {character.raceName} {character.chassisName}
                  </td>
                  <td className="muted">{character.zoneName}</td>
                  <td className="whitespace-nowrap">
                    {character.accountName ? (
                      <Link href={`/accounts/${character.accountId}`} className="mono underline">
                        {character.accountName}
                      </Link>
                    ) : (
                      <span className="muted">#{character.accountId}</span>
                    )}
                  </td>
                  <td className="muted whitespace-nowrap">
                    {character.online ? "now" : formatRelative(character.logoutTime)}
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
            <a className="btn" href={href(params, page - 1)}>
              Previous
            </a>
          ) : null}
          <span className="muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a className="btn" href={href(params, page + 1)}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

function href(params: Record<string, string | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") query.set(key, value);
  }
  query.set("page", String(page));
  return `/characters?${query.toString()}`;
}
