import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-ash)]">
        Not found
      </p>
      <h1 className="mt-2 text-xl font-semibold">There is nothing at that address</h1>
      <p className="muted mt-3 text-sm">
        Either the page has moved or the record it named no longer exists.
      </p>
      <Link className="btn mt-6 self-start" href="/">
        Back to the panel
      </Link>
    </div>
  );
}
