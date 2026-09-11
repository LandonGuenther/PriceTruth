import { existsSync, readFileSync, statSync } from "node:fs";
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
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.env/i,
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

const required = ["manifest.json", "service-worker.js", "content.js", "sidepanel.html", "sidepanel.js"];
for (const f of required) {
  if (!existsSync(path.join(dist, f))) fail(`dist missing ${f}`);
}

const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8")) as {
  host_permissions?: string[];
  permissions?: string[];
};
const bannedPerms = new Set(["tabs", "history", "cookies", "webRequest", "webNavigation", "scripting"]);
for (const p of manifest.permissions ?? []) {
  if (bannedPerms.has(p)) fail(`manifest must not include permission: ${p}`);
}

const hostPerms = manifest.host_permissions ?? [];
if (hostPerms.length === 0) fail("manifest host_permissions empty");
for (const hp of hostPerms) {
  if (/\*:\/\/\*\//.test(hp) || hp.includes("<all_urls>")) {
    fail(`over-broad host_permission: ${hp}`);
  }
}

if (!existsSync(zipPath)) {
  console.log("verify-package: zip missing; build with VITE_API_BASE_URL set to a non-localhost origin, then package.");
  fail(`zip not found at ${zipPath}`);
}

let entries: string[] = [];
try {
  entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
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

// Ensure the packaged manifest does not point host permissions at loopback.
const zipManifestRaw = execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8" });
const zipManifest = JSON.parse(zipManifestRaw) as { host_permissions?: string[] };
for (const hp of zipManifest.host_permissions ?? []) {
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(hp)) {
    fail(`packaged manifest host_permission must not use loopback: ${hp}`);
  }
}

console.log(`verify-package: ok (${entries.length} entries, ${statSync(zipPath).size} bytes) -> ${zipPath}`);
