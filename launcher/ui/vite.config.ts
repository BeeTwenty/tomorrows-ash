import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/**
 * Which build is this?
 *
 * Baked into the bundle rather than asked for over the IPC, deliberately. Two
 * bug reports have now been impossible to place against a commit — one of them
 * described a symptom whose text had been deleted two builds earlier — and a
 * version that is only readable when the Rust side answers is no use in exactly
 * the situation where you need it. This renders from the HTML alone.
 */
function buildId(): string {
  const given = process.env.ASHMORROW_BUILD || process.env.GITHUB_SHA;
  if (given) return given.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // A source tarball with no git history. Honest beats invented.
    return "unknown";
  }
}

// Tauri serves the built files from disk, so every asset reference has to be
// relative — an absolute /assets/… path resolves to nothing inside the bundle.
export default defineConfig({
  base: "./",
  define: { __BUILD__: JSON.stringify(buildId()) },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: { port: 5173, strictPort: true },
});
