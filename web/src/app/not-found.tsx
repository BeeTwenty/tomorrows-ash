import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-32 text-center sm:px-8">
      <p className="eyebrow">404</p>
      <h1 className="display mt-6 text-5xl text-bone sm:text-6xl">Nothing here but ash.</h1>
      <p className="mt-6 text-sm leading-relaxed text-ash">
        That page does not exist, or it burned down before you arrived.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <Link href="/" className="btn">
          Back to the start
        </Link>
        <Link href="/docs" className="btn">
          The wiki
        </Link>
      </div>
    </div>
  );
}
