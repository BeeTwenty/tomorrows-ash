import { NodeRow, ReloadButton, TreeRowEditor } from "@/components/TreeEditor";
import { PageHeader } from "@/components/Shell";
import { requirePermission } from "@/lib/authz";
import { can } from "@/lib/roles";
import { classlessLive, listNodes, listTrees } from "@/lib/trees";
import { soapAvailable } from "@/lib/soap";

export const dynamic = "force-dynamic";

export default async function TreesPage({
  searchParams,
}: {
  searchParams: Promise<{ tree?: string }>;
}) {
  const { actor } = await requirePermission("tree.view");
  const params = await searchParams;

  if (!(await classlessLive())) {
    return (
      <>
        <PageHeader title="Ability trees" />
        <p className="notice">
          The classless module&rsquo;s world tables are not present on this realm. Run the module&rsquo;s SQL
          migrations (they apply automatically when the worldserver starts) and this page will fill in.
        </p>
      </>
    );
  }

  const treeId = params.tree ? Number.parseInt(params.tree, 10) : undefined;
  const [trees, nodes] = await Promise.all([listTrees(), listNodes(Number.isInteger(treeId) ? treeId : undefined)]);

  const editable = can(actor, "tree.edit");

  return (
    <>
      <PageHeader
        title="Ability trees"
        description={`${trees.length} trees, ${nodes.length} nodes shown. Trees, costs and prerequisites are rows — rebalancing never needs a rebuild.`}
        actions={can(actor, "tree.reload") ? <ReloadButton /> : undefined}
      />

      {!soapAvailable() ? (
        <p className="notice mb-4">
          The worldserver console is not configured, so edits land in the database but the running server keeps
          its cached copy until it restarts.
        </p>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trees.map((tree) =>
          editable ? (
            <TreeRowEditor key={tree.id} tree={tree} />
          ) : (
            <div key={tree.id} className="panel p-4">
              <p className="font-semibold">{tree.name}</p>
              <p className="muted text-xs">{tree.description || "No description."}</p>
              <span className="chip mt-2 inline-flex">{tree.nodeCount} nodes</span>
            </div>
          ),
        )}
      </div>

      <form className="panel mb-4 flex items-end gap-3 p-3" method="get">
        <div>
          <label className="label" htmlFor="tree">
            Tree
          </label>
          <select id="tree" name="tree" className="field" defaultValue={params.tree ?? ""}>
            <option value="">All trees</option>
            {trees.map((tree) => (
              <option key={tree.id} value={tree.id}>
                {tree.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn">
          Show
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Tree</th>
              <th>Node</th>
              <th>Spell</th>
              <th>Tier</th>
              <th>Cost</th>
              <th>Min level</th>
              <th className="text-right">Bought</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No nodes.
                </td>
              </tr>
            ) : (
              nodes.map((node) =>
                editable ? (
                  <NodeRow key={node.id} node={node} />
                ) : (
                  <tr key={node.id}>
                    <td className="muted whitespace-nowrap">{node.treeName}</td>
                    <td>{node.name}</td>
                    <td className="mono muted">{node.spellId}</td>
                    <td className="mono">{node.tier}</td>
                    <td className="mono">{node.cost}</td>
                    <td className="mono">{node.requiredLevel}</td>
                    <td className="mono muted text-right">{node.purchases}</td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      <section className="panel mt-4 p-4">
        <h2 className="mb-2 text-sm font-semibold">The budget</h2>
        <p className="muted text-sm">
          Points are derived from level on every read —{" "}
          <span className="mono">(level - FirstLevel + 1) × PerLevel + Bonus</span> — and never stored. The three
          values live in <span className="mono">mod_classless.conf</span> on the worldserver, which this panel
          cannot read or write: it runs on a different machine in most deployments, and mirroring the numbers
          here would create a second source of truth that silently disagrees with the first.
        </p>
        <p className="muted mt-2 text-sm">
          Editing them from here needs the server branch to publish a{" "}
          <span className="mono">classless_config</span> table that the module reads at load. That request is
          recorded in <span className="mono">docs/decisions/0008-admin-panel.md</span>. Until it lands, character
          pages show points spent and say plainly that the total available is unknown.
        </p>
      </section>
    </>
  );
}
