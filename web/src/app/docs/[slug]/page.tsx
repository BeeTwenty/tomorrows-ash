import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmberRule } from "@/components/EmberRule";
import { getContent, listContent } from "@/lib/content";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const docs = await listContent("docs");
  return docs.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getContent("docs", slug);
  if (!doc) return { title: "Not found" };
  return { title: doc.title, description: doc.summary || undefined };
}

export default async function DocPage({ params }: Params) {
  const { slug } = await params;
  const doc = await getContent("docs", slug);
  if (!doc) notFound();

  const sections = doc.headings.filter((heading) => heading.level === 2);

  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <Link href="/docs" className="eyebrow transition-colors hover:text-ember">
        ← Wiki
      </Link>

      <h1 className="display mt-6 text-4xl text-bone sm:text-5xl">{doc.title}</h1>
      {doc.summary ? <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ash">{doc.summary}</p> : null}

      {sections.length > 2 ? (
        <nav className="panel mt-10 px-5 py-4" aria-label="On this page">
          <p className="eyebrow text-[0.625rem]">On this page</p>
          <ul className="mt-3 space-y-1.5">
            {sections.map((heading) => (
              <li key={heading.id}>
                <a href={`#${heading.id}`} className="text-sm text-ash transition-colors hover:text-ember">
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <EmberRule className="my-10" />

      {/*
        The HTML here comes from Markdown files inside this repository, which
        are reviewed like any other source file. No user input reaches it.
      */}
      <article className="prose-ash" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
