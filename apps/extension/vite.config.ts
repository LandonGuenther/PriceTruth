import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Main build: side panel (html entry) + MV3 module service worker.
 * `scripts/write-manifest.ts` then generates dist/manifest.json and flattens
 * the panel html to dist/sidepanel.html.
 */
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs are required for chrome-extension:// pages. Vite's
  // default `base: '/'` emits `/sidepanel.js`, which fails to load in the
  // side panel and looks like a dead toolbar click (blank / no UI).
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Avoid injecting the document-based modulepreload helper into the
    // service worker bundle (it crashes MV3 workers with `document is not defined`).
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(here, "src/sidepanel/index.html"),
        popup: path.resolve(here, "src/popup/index.html"),
        "service-worker": path.resolve(here, "src/background/service-worker.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
  },
});
