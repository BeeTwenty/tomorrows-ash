"use client";

import { useActionState, useState } from "react";
import { editNodeAction, editTreeAction, reloadAction, type ActionState } from "@/app/(panel)/trees/actions";

const EMPTY: ActionState = {};

function Result({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="notice notice-danger mt-3">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="notice notice-ok mt-3">
        {state.ok}
      </p>
    );
  }
  return null;
}

export function ReloadButton() {
  const [state, action, pending] = useActionState(reloadAction, EMPTY);

  return (
    <div>
      <form action={action}>
        <button type="submit" className="btn btn-ember" disabled={pending}>
          {pending ? "Reloading…" : "Reload trees on the server"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

export interface EditableNode {
  id: number;
  treeName: string;
  name: string;
  description: string;
  spellId: number;
  tier: number;
  cost: number;
  requiredLevel: number;
  enabled: boolean;
  purchases: number;
}

export function NodeRow({ node }: { node: EditableNode }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(editNodeAction, EMPTY);

  return (
    <>
      <tr>
        <td className="muted whitespace-nowrap">{node.treeName}</td>
        <td>
          <button type="button" className="underline" onClick={() => setOpen((value) => !value)}>
            {node.name}
          </button>
          {!node.enabled ? <span className="chip ml-2">Disabled</span> : null}
        </td>
        <td className="mono muted">{node.spellId}</td>
        <td className="mono">{node.tier}</td>
        <td className="mono">{node.cost}</td>
        <td className="mono">{node.requiredLevel}</td>
        <td className="mono muted text-right">{node.purchases}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="bg-[var(--color-void)]">
            <form action={action} className="space-y-3 p-3">
              <input type="hidden" name="nodeId" value={node.id} />
              <div className="flex flex-wrap gap-3">
                <div className="min-w-[14rem] flex-1">
                  <label className="label">Name</label>
                  <input name="name" className="field" defaultValue={node.name} maxLength={64} />
                </div>
                <div className="w-24">
                  <label className="label">Tier</label>
                  <input name="tier" type="number" className="field" defaultValue={node.tier} min={1} max={20} />
                </div>
                <div className="w-24">
                  <label className="label">Cost</label>
                  <input name="cost" type="number" className="field" defaultValue={node.cost} min={0} max={1000} />
                </div>
                <div className="w-28">
                  <label className="label">Min level</label>
                  <input
                    name="requiredLevel"
                    type="number"
                    className="field"
                    defaultValue={node.requiredLevel}
                    min={1}
                    max={80}
                  />
                </div>
                <div className="w-32">
                  <label className="label">Enabled</label>
                  <select name="enabled" className="field" defaultValue={node.enabled ? "1" : "0"}>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <input name="description" className="field" defaultValue={node.description} maxLength={255} />
              </div>

              <div>
                <label className="label">Reason (recorded)</label>
                <input name="reason" className="field" minLength={8} required
                  placeholder="Frostbolt was over-priced against its tier" />
              </div>

              <p className="muted text-[0.6875rem]">
                The spell id is not editable here. A node pointing at a spell that does not exist takes a
                player&rsquo;s points and gives them nothing, and only{" "}
                <span className="mono">tools/gen_trees.py</span> can prove a spell exists — so repointing a node
                is a repository change, not a form field.
                {node.purchases > 0 ? (
                  <>
                    {" "}
                    {node.purchases} character(s) have already bought this; they keep the price they paid.
                  </>
                ) : null}
              </p>

              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <Result state={state} />
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function TreeRowEditor({
  tree,
}: {
  tree: { id: number; name: string; description: string; enabled: boolean; nodeCount: number };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(editTreeAction, EMPTY);

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button type="button" className="font-semibold underline" onClick={() => setOpen((value) => !value)}>
            {tree.name}
          </button>
          <p className="muted text-xs">{tree.description || "No description."}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="chip">{tree.nodeCount} nodes</span>
          {!tree.enabled ? <span className="chip ml-1">Disabled</span> : null}
        </div>
      </div>

      {open ? (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="treeId" value={tree.id} />
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[14rem] flex-1">
              <label className="label">Name</label>
              <input name="name" className="field" defaultValue={tree.name} maxLength={64} />
            </div>
            <div className="w-32">
              <label className="label">Enabled</label>
              <select name="enabled" className="field" defaultValue={tree.enabled ? "1" : "0"}>
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input name="description" className="field" defaultValue={tree.description} maxLength={255} />
          </div>
          <div>
            <label className="label">Reason (recorded)</label>
            <input name="reason" className="field" minLength={8} required />
          </div>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <Result state={state} />
        </form>
      ) : null}
    </div>
  );
}
