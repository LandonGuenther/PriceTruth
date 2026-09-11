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

/**
 * Vite emits html inputs under their src-relative paths. Chrome wants flat
 * files at dist/*.html. After moving, rewrite asset URLs that still point
 * up from the old depth (`../../foo.js` → `./foo.js`).
 */
function flattenHtml(emittedRelative: string, flatName: string): void {
  const emittedHtml = path.join(dist, emittedRelative);
  const flatHtml = path.join(dist, flatName);
  if (existsSync(emittedHtml)) {
    renameSync(emittedHtml, flatHtml);
  } else if (!existsSync(flatHtml)) {
    throw new Error(`${flatName} missing from vite output (expected ${emittedRelative})`);
  }

  let html = readFileSync(flatHtml, "utf8");
  html = html
    .replaceAll('src="../../', 'src="./')
    .replaceAll('href="../../', 'href="./')
    .replaceAll('src="/', 'src="./')
    .replaceAll('href="/', 'href="./')
    .replaceAll(" crossorigin", "");
  writeFileSync(flatHtml, html);
}

flattenHtml("src/sidepanel/index.html", "sidepanel.html");
flattenHtml("src/popup/index.html", "popup.html");
if (existsSync(path.join(dist, "src"))) {
  rmSync(path.join(dist, "src"), { recursive: true, force: true });
}

mkdirSync(path.join(appDir, "release"), { recursive: true });
console.log(
  `Wrote dist/manifest.json (api origin ${apiOrigin}), dist/sidepanel.html, dist/popup.html`,
);
