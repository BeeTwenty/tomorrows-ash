import type { Metadata } from "next";
import Link from "next/link";
import { listContent } from "@/lib/content";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Patch notes",
  description: "What has changed on Ashmorrow, in order.",
};

export default async function PatchNotesIndex() {
  const notes = await listContent("patch-notes");

  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <p className="eyebrow">Patch notes</p>
      <h1 className="display mt-6 text-5xl text-bone sm:text-6xl">A record of every change.</h1>
      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ash">
        Including the ones that did not work. A private server that only publishes its wins is a
        private server you cannot plan around.
      </p>

      <ol className="mt-14 space-y-px border border-edge bg-edge">
        {notes.map((note) => (
          <li key={note.slug}>
            <Link href={`/patch-notes/${note.slug}`} className="group block bg-void px-6 py-6 transition-colors hover:bg-soot">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {note.version ? <span className="numeric text-xs text-ember">{note.version}</span> : null}
                <time className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash/70">
                  {formatDate(note.date)}
                </time>
              </div>
              <h2 className="display mt-2 text-2xl text-bone transition-colors group-hover:text-ember">
                {note.title}
              </h2>
              {note.summary ? <p className="mt-2 text-sm leading-relaxed text-ash">{note.summary}</p> : null}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
