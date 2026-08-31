"use client";

import { useActionState } from "react";
import { announceAction, maintenanceAction, motdAction, type ActionState } from "@/app/(panel)/realm/actions";

const EMPTY: ActionState = {};

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="notice notice-danger mt-3">{state.error}</p>;
  if (state.ok) return <p role="status" className="notice notice-ok mt-3">{state.ok}</p>;
  return null;
}

export function MotdForm({ motd }: { motd: string }) {
  const [state, action, pending] = useActionState(motdAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      {/*
        Keyed on the server's value so the field re-syncs after a save.
        `defaultValue` applies at mount, and this component stays mounted across
        the revalidation - so without the key the box would keep showing what
        was typed even if the save changed it, or another operator changed it
        first. The key is on the field and not the form, because remounting the
        form would take the result message with it.
      */}
      <textarea key={motd} name="motd" className="field min-h-24" defaultValue={motd} maxLength={500} required />
      <p className="muted text-[0.6875rem]">
        Stored in <span className="mono">acore_auth.motd</span>, so it survives a restart, and pushed to the
        running server through the console when one is configured.
      </p>
      <button type="submit" className="btn btn-ember" disabled={pending}>
        {pending ? "Saving…" : "Set the message of the day"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function MaintenanceForm({ level }: { level: number }) {
  const [state, action, pending] = useActionState(maintenanceAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="maintenance-level">
          Minimum level allowed to log in
        </label>
        {/* Keyed for the same reason as the MOTD box above: after applying,
            this must show what is in force, not what was last picked. */}
        <select key={level} id="maintenance-level" name="level" className="field" defaultValue={String(level)}>
          <option value="0">0 — open to everyone</option>
          <option value="1">1 — support and above</option>
          <option value="2">2 — game masters and above</option>
          <option value="3">3 — administrators only</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="maintenance-reason">
          Reason (recorded)
        </label>
        <input id="maintenance-reason" name="reason" className="field" minLength={8} required
          placeholder="Applying the 2026-09-01 content patch" />
      </div>
      <p className="muted text-[0.6875rem]">
        This is <span className="mono">realmlist.allowedSecurityLevel</span>. The realm stays visible and shows
        as locked to anyone below the level, which tells players something is happening — unlike hiding it.
        Nobody already connected is disconnected.
      </p>
      <button type="submit" className="btn btn-danger" disabled={pending}>
        {pending ? "Applying…" : "Apply"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function AnnounceForm({ soapReady }: { soapReady: boolean }) {
  const [state, action, pending] = useActionState(announceAction, EMPTY);

  if (!soapReady) {
    return (
      <p className="notice">
        An in-game announcement needs the worldserver console, which is not configured. There is nowhere to
        store one for later, so nothing is offered here.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input name="message" className="field" maxLength={255} required placeholder="Restarting in 10 minutes." />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Sending…" : "Announce to everyone online"}
      </button>
      <Result state={state} />
    </form>
  );
}
