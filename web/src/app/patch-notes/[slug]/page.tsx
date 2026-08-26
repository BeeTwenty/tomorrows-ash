import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmberRule } from "@/components/EmberRule";
import { getContent, listContent } from "@/lib/content";
import { formatDate } from "@/lib/format";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const notes = await listContent("patch-notes");
  return notes.map((note) => ({ slug: note.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const note = await getContent("patch-notes", slug);
  if (!note) return { title: "Not found" };
  return { title: note.title, description: note.summary || undefined };
}

export default async function PatchNotePage({ params }: Params) {
  const { slug } = await params;
  const note = await getContent("patch-notes", slug);
  if (!note) notFound();

  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <Link href="/patch-notes" className="eyebrow transition-colors hover:text-ember">
        ← Patch notes
      </Link>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {note.version ? <span className="numeric text-sm text-ember">{note.version}</span> : null}
        <time className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash/70">
          {formatDate(note.date)}
        </time>
      </div>

      <h1 className="display mt-3 text-4xl text-bone sm:text-5xl">{note.title}</h1>
      {note.summary ? <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ash">{note.summary}</p> : null}

      <EmberRule className="my-10" />

      <article className="prose-ash" dangerouslySetInnerHTML={{ __html: note.html }} />
    </div>
  );
}
