"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The error boundary.
 *
 * `AccessDenied` from the authorisation guard lands here, and so does anything
 * unexpected. Both render the same way on purpose: an operator does not need a
 * stack trace, and a stack trace on a page reachable by an unauthenticated
 * request is a small gift to whoever is probing it.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);

  const denied = error.name === "AccessDenied";

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-ash)]">
        {denied ? "Refused" : "Something went wrong"}
      </p>
      <h1 className="mt-2 text-xl font-semibold">
        {denied ? "You are not permitted to do that" : "The panel could not complete that request"}
      </h1>
      <p className="muted mt-3 text-sm">
        {denied
          ? error.message
          : "The failure has been logged. If it repeats, check the panel's own logs before retrying."}
      </p>
      {denied ? (
        <p className="muted mt-3 text-xs">
          Refusals are recorded in the audit log with the permission that was missing.
        </p>
      ) : null}
      <div className="mt-6 flex gap-3">
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>
        <Link className="btn" href="/">
          Back to the panel
        </Link>
      </div>
    </div>
  );
}
