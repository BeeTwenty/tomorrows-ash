"use client";

import { useActionState } from "react";
import {
  banAction,
  lockAction,
  muteAction,
  resetPasswordAction,
  setGmLevelAction,
  unbanAction,
  type ActionState,
} from "@/app/(panel)/accounts/actions";

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
      <div className="notice notice-ok mt-3" role="status">
        <p>{state.ok}</p>
        {state.password ? (
          <p className="mono mt-2 select-all text-base tracking-wider text-[var(--color-bone)]">{state.password}</p>
        ) : null}
      </div>
    );
  }
  return null;
}

/**
 * Ban and unban, in one component with the results rendered *outside* the form
 * that produced them.
 *
 * That placement is the whole point. A successful unban revalidates the page,
 * `banned` flips to false, and the unban form unmounts - taking its own success
 * message with it. The operator would see the ban form appear and no
 * confirmation that anything happened, which reads exactly like a click that
 * did not register. Keeping both results above the swap means the message
 * outlives the form.
 */
export function BanPanel({
  accountId,
  username,
  banned,
}: {
  accountId: number;
  username: string;
  banned: boolean;
}) {
  const [banState, ban, banPending] = useActionState(banAction, EMPTY);
  const [unbanState, unban, unbanPending] = useActionState(unbanAction, EMPTY);

  return (
    <div className="space-y-3">
      <Result state={banState} />
      <Result state={unbanState} />

      {banned ? (
        <form action={unban} className="space-y-3">
          <input type="hidden" name="accountId" value={accountId} />
          <div>
            <label className="label" htmlFor="unban-reason">
              Reason (recorded)
            </label>
            <input id="unban-reason" name="reason" className="field" minLength={8} required
              placeholder="Appeal upheld, ticket #123" />
          </div>
          <button type="submit" className="btn btn-ember" disabled={unbanPending}>
            {unbanPending ? "Lifting…" : `Lift the ban on ${username}`}
          </button>
        </form>
      ) : (
        <form action={ban} className="space-y-3">
          <input type="hidden" name="accountId" value={accountId} />
          <div className="flex gap-3">
            <div className="w-32">
              <label className="label" htmlFor="ban-days">
                Days
              </label>
              <input id="ban-days" name="days" type="number" className="field" defaultValue={0} min={0} max={3650} />
              <p className="muted mt-1 text-[0.6875rem]">0 is permanent.</p>
            </div>
            <div className="flex-1">
              <label className="label" htmlFor="ban-reason">
                Reason (recorded, and shown to the player)
              </label>
              <input id="ban-reason" name="reason" className="field" minLength={8} required
                placeholder="Advertising in /say, ticket #123" />
            </div>
          </div>
          <button type="submit" className="btn btn-danger" disabled={banPending}>
            {banPending ? "Banning…" : `Ban ${username}`}
          </button>
        </form>
      )}
    </div>
  );
}

export function PasswordPanel({ accountId, username }: { accountId: number; username: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="accountId" value={accountId} />
      <p className="muted text-sm">
        Generates a new password and shows it once. Nothing stores it — not the log, not this page after a
        refresh. Every session {username} has, in game and here, ends immediately.
      </p>
      <div>
        <label className="label" htmlFor="reset-reason">
          Reason (recorded)
        </label>
        <input id="reset-reason" name="reason" className="field" placeholder="Lost password, verified by email" />
      </div>
      <button type="submit" className="btn btn-ember" disabled={pending}>
        {pending ? "Resetting…" : "Reset the password"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function GmLevelPanel({
  accountId,
  username,
  currentLevel,
  actorLevel,
}: {
  accountId: number;
  username: string;
  currentLevel: number;
  actorLevel: number;
}) {
  const [state, action, pending] = useActionState(setGmLevelAction, EMPTY);

  // The server refuses anything at or above the actor's own level regardless of
  // what the form offers; the list is trimmed so the refusal is rarely reached.
  const levels = [0, 1, 2, 3, 4].filter((level) => level < actorLevel);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex gap-3">
        <div className="w-40">
          <label className="label" htmlFor="gm-level">
            Level
          </label>
          {/* Keyed on the server value; see CharacterActions.EditPanel. */}
          <select key={currentLevel} id="gm-level" name="level" className="field" defaultValue={String(currentLevel)}>
            {levels.map((level) => (
              <option key={level} value={level}>
                {level} — {["Player", "Support", "Game master", "Administrator", "Console"][level]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="gm-reason">
            Reason (recorded)
          </label>
          <input id="gm-reason" name="reason" className="field" minLength={8} required
            placeholder="Promoted to GM, agreed with the team" />
        </div>
      </div>
      <p className="muted text-[0.6875rem]">
        You cannot grant a level at or above your own ({actorLevel}), and you cannot change your own.
      </p>
      <button type="submit" className="btn btn-danger" disabled={pending}>
        {pending ? "Applying…" : `Set ${username}'s staff level`}
      </button>
      <Result state={state} />
    </form>
  );
}

export function MutePanel({ accountId, muted }: { accountId: number; muted: boolean }) {
  const [state, action, pending] = useActionState(muteAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex gap-3">
        <div className="w-32">
          <label className="label" htmlFor="mute-minutes">
            Minutes
          </label>
          {/* Keyed on the server value; see CharacterActions.EditPanel. */}
          <input
            key={String(muted)}
            id="mute-minutes"
            name="minutes"
            type="number"
            className="field"
            defaultValue={muted ? 0 : 60}
            min={0}
            max={43200}
          />
          <p className="muted mt-1 text-[0.6875rem]">0 lifts it.</p>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="mute-reason">
            Reason (recorded)
          </label>
          <input id="mute-reason" name="reason" className="field" minLength={8} required
            placeholder="Abusive language in /general" />
        </div>
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Applying…" : muted ? "Update the mute" : "Mute"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function LockPanel({ accountId, locked }: { accountId: number; locked: boolean }) {
  const [state, action, pending] = useActionState(lockAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="locked" value={locked ? "0" : "1"} />
      <p className="muted text-sm">
        An IP lock pins the account to the address it last logged in from. It is a theft response, not a
        punishment.
      </p>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Applying…" : locked ? "Remove the IP lock" : "Lock to last IP"}
      </button>
      <Result state={state} />
    </form>
  );
}
