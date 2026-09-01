"use client";

import { useActionState } from "react";
import { promoteAction, stageAction, withdrawAction, type ActionState } from "@/app/(panel)/items/actions";

const EMPTY: ActionState = {};

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="notice notice-danger mt-3">{state.error}</p>;
  if (state.ok) return <p role="status" className="notice notice-ok mt-3">{state.ok}</p>;
  return null;
}

export function StageForm({ entry, name, current }: { entry: number; name: string; current: number }) {
  const [state, action, pending] = useActionState(stageAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="entry" value={entry} />
      <p className="text-sm">
        {name} <span className="muted mono">#{entry}</span>
      </p>
      <div className="flex gap-3">
        <div className="w-48">
          <label className="label">New AllowableClass</label>
          <select name="newValue" className="field" defaultValue={current === -1 ? "0" : "-1"}>
            <option value="-1">-1 — unrestricted</option>
            <option value="0">0 — no class (unobtainable)</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="label">Reason (recorded)</label>
          <input name="reason" className="field" minLength={8} required
            placeholder="Missed by the Phase 3 pass; relic, not gear" />
        </div>
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Staging…" : "Stage the change"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function PromoteButtons({ id, canPromote }: { id: number; canPromote: boolean }) {
  const [promoteState, promote, promotePending] = useActionState(promoteAction, EMPTY);
  const [withdrawState, withdraw, withdrawPending] = useActionState(withdrawAction, EMPTY);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {canPromote ? (
          <form action={promote} className="flex items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <input name="reason" className="field w-64" minLength={8} required placeholder="Reason (recorded)" />
            <button type="submit" className="btn btn-danger" disabled={promotePending}>
              {promotePending ? "Applying…" : "Promote"}
            </button>
          </form>
        ) : null}
        <form action={withdraw}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="btn" disabled={withdrawPending}>
            {withdrawPending ? "Withdrawing…" : "Withdraw"}
          </button>
        </form>
      </div>
      <Result state={promoteState} />
      <Result state={withdrawState} />
    </div>
  );
}
