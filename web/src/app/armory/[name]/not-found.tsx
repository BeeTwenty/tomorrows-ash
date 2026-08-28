import Link from "next/link";

export default function CharacterNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-32 text-center sm:px-8">
      <p className="eyebrow">Not in the record</p>
      <h1 className="display mt-6 text-4xl text-bone sm:text-5xl">No such character.</h1>
      <p className="mt-6 text-sm leading-relaxed text-ash">
        Either that name has never been written on Ashmorrow, or the character has not logged in yet.
        Staff characters are not listed.
      </p>
      <Link href="/armory" className="btn mt-10">
        Back to the armory
      </Link>
    </div>
  );
}
