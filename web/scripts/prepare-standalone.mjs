#!/usr/bin/env node
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Finish the standalone build.
 *
 * `output: "standalone"` produces a self-contained server in .next/standalone
 * but deliberately leaves out static assets and anything Next cannot trace -
 * upstream expects the deployer to copy them. Doing it here means
 * `npm run build && npm start` works the same on a laptop, in a container and
 * under systemd, instead of only inside the Dockerfile.
 *
 * It runs as part of `npm run build`, which means it also runs on platforms
 * that build Next.js their own way. It must therefore never fail a build it
 * has nothing to contribute to - see the exit(0) below.
 */
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(standalone))) {
  // Not an error. This step exists for self-hosting, where `npm start` serves
  // .next/standalone. Platforms that build and serve Next.js themselves -
  // Vercel among them - do not leave a standalone directory behind, and this
  // script must not fail their build over a directory they had no reason to
  // produce. Anything that genuinely needs it will find `npm start` says so.
  console.log("No .next/standalone directory - skipping (the platform serves Next.js itself).");
  process.exit(0);
}

const copies = [
  // Hashed JS and CSS the pages reference.
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
  // Anything served straight from /public.
  [path.join(root, "public"), path.join(standalone, "public")],
  // The wiki and patch notes are read from disk when a page revalidates.
  [path.join(root, "content"), path.join(standalone, "content")],
];

for (const [from, to] of copies) {
  if (!(await exists(from))) continue;
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`  copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

console.log("Standalone server ready: node .next/standalone/server.js");
