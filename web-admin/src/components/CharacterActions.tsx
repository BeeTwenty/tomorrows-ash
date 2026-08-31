"use client";

import { useActionState } from "react";
import {
  editCharacterAction,
  kickAction,
  queueAtLoginAction,
  reviveAction,
  teleportAction,
  type ActionState,
} from "@/app/(panel)/characters/actions";

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

export function EditPanel({
  guid,
  level,
  money,
  online,
}: {
  guid: number;
  level: number;
  money: number;
  online: boolean;
}) {
  const [state, action, pending] = useActionState(editCharacterAction, EMPTY);

  if (online) {
    return (
      <p className="notice notice-warn">
        This character is online. The worldserver holds their data in memory and would overwrite anything
        written here, so direct edits are refused until they log out. Kick them below if it is urgent.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="guid" value={guid} />
      <div className="flex gap-3">
        <div className="w-28">
          <label className="label" htmlFor="edit-level">
            Level
          </label>
          <input id="edit-level" name="level" type="number" className="field" defaultValue={level} min={1} max={80} />
        </div>
        <div className="w-40">
          <label className="label" htmlFor="edit-gold">
            Gold
          </label>
          <input
            id="edit-gold"
            name="gold"
            type="number"
            step="0.0001"
            className="field"
            defaultValue={(money / 10_000).toFixed(4)}
            min={0}
          />
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="edit-reason">
            Reason (recorded)
          </label>
          <input id="edit-reason" name="reason" className="field" minLength={8} required
            placeholder="Restoring gold lost to the mail bug, ticket #123" />
        </div>
      </div>
      <p className="muted text-[0.6875rem]">
        A level change here also zeroes experience, because leftover experience past the new level&rsquo;s
        requirement would level the character straight back up. It does not re-grant talent points or
        recompute anything else — for a proper level change use the console.
      </p>
      <button type="submit" className="btn btn-ember" disabled={pending}>
        {pending ? "Saving…" : "Apply"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function ConsolePanel({
  guid,
  name,
  online,
  destinations,
  canKick,
  canRevive,
  canTeleport,
  soapReady,
}: {
  guid: number;
  name: string;
  online: boolean;
  destinations: { id: number; name: string }[];
  canKick: boolean;
  canRevive: boolean;
  canTeleport: boolean;
  soapReady: boolean;
}) {
  const [kickState, kick, kickPending] = useActionState(kickAction, EMPTY);
  const [reviveState, revive, revivePending] = useActionState(reviveAction, EMPTY);
  const [teleportState, teleport, teleportPending] = useActionState(teleportAction, EMPTY);

  if (!soapReady) {
    return (
      <p className="notice">
        These need the worldserver&rsquo;s console, which is not configured. Set SOAP_ENABLED=1 and the
        credentials in the panel&rsquo;s environment, with SOAP.Enabled = 1 in worldserver.conf.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {canKick ? (
        <form action={kick} className="space-y-2">
          <input type="hidden" name="guid" value={guid} />
          <input name="reason" className="field" placeholder="Reason (recorded)" />
          <button type="submit" className="btn btn-danger" disabled={kickPending || !online}>
            {kickPending ? "Disconnecting…" : online ? `Disconnect ${name}` : `${name} is offline`}
          </button>
          <Result state={kickState} />
        </form>
      ) : null}

      {canRevive ? (
        <form action={revive} className="space-y-2">
          <input type="hidden" name="guid" value={guid} />
          <button type="submit" className="btn" disabled={revivePending || !online}>
            {revivePending ? "Reviving…" : "Revive"}
          </button>
          <Result state={reviveState} />
        </form>
      ) : null}

      {canTeleport && destinations.length > 0 ? (
        <form action={teleport} className="space-y-2">
          <input type="hidden" name="guid" value={guid} />
          <label className="label" htmlFor="teleport-id">
            Teleport to
          </label>
          <select id="teleport-id" name="teleportId" className="field">
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name}
              </option>
            ))}
          </select>
          <input name="reason" className="field" placeholder="Reason (recorded)" />
          <button type="submit" className="btn" disabled={teleportPending || !online}>
            {teleportPending ? "Teleporting…" : "Teleport"}
          </button>
          <p className="muted text-[0.6875rem]">
            Destinations come from the world database&rsquo;s <span className="mono">game_tele</span> table, so
            the command never carries typed-in text.
          </p>
          <Result state={teleportState} />
        </form>
      ) : null}
    </div>
  );
}

const FLAGS: { value: string; label: string }[] = [
  { value: "rename", label: "Force a rename" },
  { value: "customize", label: "Offer an appearance change" },
  { value: "resetSpells", label: "Reset spells" },
  { value: "resetTalents", label: "Reset talents" },
  { value: "changeFaction", label: "Offer a faction change" },
  { value: "changeRace", label: "Offer a race change" },
];

export function AtLoginPanel({ guid }: { guid: number }) {
  const [state, action, pending] = useActionState(queueAtLoginAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="guid" value={guid} />
      <div>
        <label className="label" htmlFor="flag">
          Queue for next login
        </label>
        <select id="flag" name="flag" className="field">
          {FLAGS.map((flag) => (
            <option key={flag.value} value={flag.value}>
              {flag.label}
            </option>
          ))}
        </select>
      </div>
      <input name="reason" className="field" placeholder="Reason (recorded)" minLength={8} required />
      <p className="muted text-[0.6875rem]">
        Safe while the character is online — the flag is read when their next session starts.
      </p>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Queuing…" : "Queue"}
      </button>
      <Result state={state} />
    </form>
  );
}
