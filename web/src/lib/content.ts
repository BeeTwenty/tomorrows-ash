import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

/**
 * The wiki and patch notes are Markdown files in `web/content/`.
 *
 * Keeping them in the repository means they are reviewed like code, they
 * version with the realm they describe, and adding a page needs no database
 * and no CMS. The pages are statically generated, so this only runs at build
 * time in production.
 */

export type ContentKind = "docs" | "patch-notes";

export interface ContentMeta {
  slug: string;
  title: string;
  summary: string;
  /** Docs ordering; lower comes first. */
  order: number;
  /** Patch notes only. */
  date: Date | null;
  version: string | null;
  tags: string[];
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface ContentDocument extends ContentMeta {
  html: string;
  headings: Heading[];
}

const CONTENT_ROOT = path.join(process.cwd(), "content");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

/**
 * Minimal front-matter reader: `key: value` lines between `---` fences.
 *
 * A YAML parser would be a dependency for something this small, and the fields
 * are ours - if a value ever needs to be structured, it belongs in code.
 */
function splitFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };

  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };

  const header = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};

  for (const line of header.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key) data[key] = value;
  }

  return { data, body };
}

function toMeta(slug: string, data: Record<string, string>): ContentMeta {
  const rawDate = data.date ? new Date(data.date) : null;
  return {
    slug,
    title: data.title ?? slug,
    summary: data.summary ?? "",
    order: data.order ? Number.parseInt(data.order, 10) || 999 : 999,
    date: rawDate && !Number.isNaN(rawDate.getTime()) ? rawDate : null,
    version: data.version ?? null,
    tags: data.tags ? data.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
  };
}

marked.setOptions({ gfm: true, breaks: false });

async function render(body: string): Promise<{ html: string; headings: Heading[] }> {
  const parsed = await marked.parse(body);
  const headings: Heading[] = [];

  // Anchor ids are added after rendering rather than through a custom
  // renderer: it keeps this independent of marked's renderer API, which has
  // changed shape between major versions.
  const html = parsed.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const id = slugify(text);
    headings.push({ level: Number.parseInt(level, 10), text, id });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });

  return { html, headings };
}

async function listFiles(kind: ContentKind): Promise<string[]> {
  try {
    const entries = await readdir(path.join(CONTENT_ROOT, kind));
    return entries.filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export async function listContent(kind: ContentKind): Promise<ContentMeta[]> {
  const files = await listFiles(kind);
  const metas = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.md$/, "");
      const raw = await readFile(path.join(CONTENT_ROOT, kind, file), "utf8");
      return toMeta(slug, splitFrontMatter(raw).data);
    }),
  );

  if (kind === "patch-notes") {
    return metas.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }
  return metas.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export async function getContent(kind: ContentKind, slug: string): Promise<ContentDocument | null> {
  // Defends the file read against `../` in a route parameter.
  if (!/^[a-z0-9-]+$/.test(slug)) return null;

  try {
    const raw = await readFile(path.join(CONTENT_ROOT, kind, `${slug}.md`), "utf8");
    const { data, body } = splitFrontMatter(raw);
    const { html, headings } = await render(body);
    return { ...toMeta(slug, data), html, headings };
  } catch {
    return null;
  }
}
