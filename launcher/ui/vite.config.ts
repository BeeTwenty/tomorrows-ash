import { defineConfig } from "vite";

// Tauri serves the built files from disk, so every asset reference has to be
// relative — an absolute /assets/… path resolves to nothing inside the bundle.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: { port: 5173, strictPort: true },
});
