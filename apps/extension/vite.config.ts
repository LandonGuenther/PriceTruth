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
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(here, "src/sidepanel/index.html"),
        "service-worker": path.resolve(here, "src/background/service-worker.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
  },
});
