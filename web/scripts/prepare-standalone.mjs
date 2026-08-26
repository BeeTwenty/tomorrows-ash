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
  console.error("No .next/standalone directory - run `next build` first.");
  process.exit(1);
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
