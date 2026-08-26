import type { Metadata } from "next";
import Link from "next/link";
import { listContent } from "@/lib/content";

export const metadata: Metadata = {
  title: "Wiki",
  description: "How the classless system works, how to get started, and what the realm is for.",
};

export default async function DocsIndex() {
  const docs = await listContent("docs");

  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <p className="eyebrow">Wiki</p>
      <h1 className="display mt-6 text-5xl text-bone sm:text-6xl">Read before you burn.</h1>
      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ash">
        Everything a new player needs, written plainly. If something here is wrong, that is a bug —
        the same rule the rest of this project runs on.
      </p>

      <ul className="mt-14 space-y-px border border-edge bg-edge">
        {docs.map((doc) => (
          <li key={doc.slug}>
            <Link href={`/docs/${doc.slug}`} className="group block bg-void px-6 py-6 transition-colors hover:bg-soot">
              <h2 className="display text-2xl text-bone transition-colors group-hover:text-ember">
                {doc.title}
              </h2>
              {doc.summary ? <p className="mt-2 text-sm leading-relaxed text-ash">{doc.summary}</p> : null}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs leading-relaxed text-ash/70">
        Building the server rather than playing on it? The developer documentation — architecture,
        decisions, the research the classless design rests on — lives in{" "}
        <a
          href="https://github.com/BeeTwenty/tomorrows-ash/tree/main/docs"
          className="text-ash transition-colors hover:text-ember"
          rel="noreferrer noopener"
          target="_blank"
        >
          the repository
        </a>
        .
      </p>
    </div>
  );
}
