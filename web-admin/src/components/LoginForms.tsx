"use client";

import { useActionState } from "react";
import {
  enrolAction,
  finishEnrolmentAction,
  passwordAction,
  restartEnrolmentAction,
  verifyAction,
  type FormState,
} from "@/app/login/actions";

const EMPTY: FormState = {};

function Problem({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="notice notice-danger mt-4">
      {message}
    </p>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordAction, EMPTY);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="username">
          Account
        </label>
        <input
          id="username"
          name="username"
          className="field uppercase"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          /* The 3.3.5a client cannot send more than 16, so neither can an account. */
          maxLength={16}
          required
          autoFocus
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete="current-password"
          maxLength={16}
          required
        />
      </div>

      <Problem message={state.error} />

      <button type="submit" className="btn w-full" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyAction, EMPTY);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="code">
          Authenticator code
        </label>
        <input
          id="code"
          name="code"
          className="field text-center text-lg tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={20}
          required
          autoFocus
        />
      </div>

      <Problem message={state.error} />

      <button type="submit" className="btn btn-ember w-full" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>

      <details className="text-xs">
        <summary className="muted cursor-pointer">Lost your authenticator?</summary>
        <p className="muted mt-2">
          Enter one of the recovery codes issued when you enrolled. Each works once.
        </p>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" name="mode" value="recovery" />
          <span>The value above is a recovery code</span>
        </label>
        <p className="muted mt-2">
          Out of codes? An owner can clear your enrolment; there is no way to do it yourself, by
          design.
        </p>
      </details>
    </form>
  );
}

export function EnrolForm({ secret, uri }: { secret: string; uri: string }) {
  const [state, action, pending] = useActionState(enrolAction, EMPTY);

  if (state.recoveryCodes) {
    return <RecoveryCodes codes={state.recoveryCodes} />;
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="panel p-4">
        <p className="label">Add this to your authenticator</p>
        <p className="mono break-all text-[var(--color-bone)]">{secret}</p>
        <p className="muted mt-3 text-xs">
          Or open this URI on the device holding your authenticator:
        </p>
        <p className="mono muted mt-1 break-all text-[0.6875rem]">{uri}</p>
        <p className="muted mt-3 text-xs">
          There is no QR code here on purpose — rendering one needs a library from a CDN, and this
          panel is built to load nothing from outside itself.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className="label" htmlFor="code">
            Confirm with a code
          </label>
          <input
            id="code"
            name="code"
            className="field text-center text-lg tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={10}
            required
            autoFocus
          />
        </div>

        <Problem message={state.error} />

        <button type="submit" className="btn btn-ember w-full" disabled={pending}>
          {pending ? "Confirming…" : "Confirm and continue"}
        </button>
      </form>

      <form action={restartEnrolmentAction}>
        <button type="submit" className="muted text-xs underline">
          Lost the device — issue a new secret
        </button>
      </form>
      <p className="muted text-[0.6875rem]">
        Refreshing this page keeps the secret above, so a stray reload cannot invalidate the one you are
        part-way through scanning.
      </p>
    </div>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="mt-6 space-y-5">
      <div className="notice notice-warn">
        These ten codes are shown once and are not recoverable. Write them down somewhere that is
        not this machine.
      </div>

      <ul className="panel grid grid-cols-2 gap-x-4 gap-y-1 p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <form action={finishEnrolmentAction}>
        <button type="submit" className="btn w-full">
          I have written these down — continue
        </button>
      </form>
    </div>
  );
}
