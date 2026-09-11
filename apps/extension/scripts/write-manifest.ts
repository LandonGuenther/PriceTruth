import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../src/manifest.js";
import pkg from "../package.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const dist = path.join(appDir, "dist");

const apiBase = process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";
const apiOrigin = new URL(apiBase).origin;

const manifest = buildManifest(pkg.version, apiOrigin);
writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Vite emits the html input under its src-relative path; the manifest and
// Chrome want a flat dist/sidepanel.html.
const emittedHtml = path.join(dist, "src/sidepanel/index.html");
const flatHtml = path.join(dist, "sidepanel.html");
if (existsSync(emittedHtml)) {
  renameSync(emittedHtml, flatHtml);
  rmSync(path.join(dist, "src"), { recursive: true, force: true });
} else if (!existsSync(flatHtml)) {
  throw new Error("sidepanel html missing from vite output");
}

// After flattening from dist/src/sidepanel/index.html → dist/sidepanel.html,
// Vite's relative `base: './'` URLs are still rooted at the old depth
// (`../../sidepanel.js`). Rewrite them to be relative to dist/. Also convert
// any leftover root-absolute URLs and strip `crossorigin` (breaks module
// loads on chrome-extension:// pages).
let html = readFileSync(flatHtml, "utf8");
html = html
  .replaceAll('src="../../', 'src="./')
  .replaceAll('href="../../', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replaceAll('href="/', 'href="./')
  .replaceAll(" crossorigin", "");
writeFileSync(flatHtml, html);

mkdirSync(path.join(appDir, "release"), { recursive: true });
console.log(`Wrote dist/manifest.json (api origin ${apiOrigin}) and dist/sidepanel.html`);
