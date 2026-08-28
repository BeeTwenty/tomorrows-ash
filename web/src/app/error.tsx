"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The last line of defence. It shows no error text: a stack trace on a public
 * page can name hosts, schemas and file paths. The digest is enough to find
 * the matching entry in the server log.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page] unhandled error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-5 py-32 text-center sm:px-8">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="display mt-6 text-5xl text-bone sm:text-6xl">The fire went out.</h1>
      <p className="mt-6 text-sm leading-relaxed text-ash">
        This page could not be rendered. If it keeps happening, the realm database is usually the
        reason — the status page will say.
      </p>

      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <button type="button" onClick={reset} className="btn">
          Try again
        </button>
        <Link href="/status" className="btn">
          Realm status
        </Link>
      </div>

      {error.digest ? (
        <p className="numeric mt-10 text-xs text-ash/50">reference {error.digest}</p>
      ) : null}
    </div>
  );
}
