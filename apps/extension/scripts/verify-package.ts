import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PRODUCT_SLUG } from "@pricetruth/shared";
import pkg from "../package.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const dist = path.join(appDir, "dist");
const releaseDir = path.join(appDir, "release");
const zipPath = path.join(releaseDir, `${PRODUCT_SLUG}-extension-${pkg.version}.zip`);

const FORBIDDEN = [
  /(^|\/)node_modules(\.|\/|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)fixtures?(\/|$)/i,
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /(^|\/)src(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
];

function fail(msg: string): never {
  console.error(`verify-package: ${msg}`);
  process.exit(1);
}

if (!existsSync(dist)) fail(`missing dist at ${dist}; run build first`);
const manifest = path.join(dist, "manifest.json");
if (!existsSync(manifest)) fail("dist/manifest.json missing");

const required = ["manifest.json", "service-worker.js", "content.js", "sidepanel.html"];
for (const f of required) {
  if (!existsSync(path.join(dist, f))) fail(`dist missing required file: ${f}`);
}

if (!existsSync(zipPath)) {
  execFileSync("pnpm", ["package"], { cwd: appDir, stdio: "inherit" });
}
if (!existsSync(zipPath)) fail(`zip not found at ${zipPath}`);

let entries: string[] = [];
try {
  const out = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  entries = out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
} catch {
  fail("unzip -Z1 failed; install unzip to verify package contents");
}

if (entries.length === 0) fail("zip is empty");
for (const entry of entries) {
  for (const re of FORBIDDEN) {
    if (re.test(entry)) fail(`forbidden path in zip: ${entry}`);
  }
}

const size = statSync(zipPath).size;
console.log(`verify-package: ok (${entries.length} entries, ${size} bytes) -> ${zipPath}`);
