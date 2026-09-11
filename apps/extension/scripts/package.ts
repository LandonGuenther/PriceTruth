import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import { PRODUCT_SLUG } from "@pricetruth/shared";
import pkg from "../package.json" with { type: "json" };
import { assertProductionApiUrl } from "./assert-production-api-url.js";

// Production packaging must not ship a localhost API origin.
assertProductionApiUrl(process.env.VITE_API_BASE_URL);

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const dist = path.join(appDir, "dist");
const releaseDir = path.join(appDir, "release");
mkdirSync(releaseDir, { recursive: true });

const out = path.join(releaseDir, `${PRODUCT_SLUG}-extension-${pkg.version}.zip`);
const output = createWriteStream(out);
const archive = archiver("zip", { zlib: { level: 9 } });

await new Promise<void>((resolve, reject) => {
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(dist, false);
  void archive.finalize();
});
console.log(`Wrote ${out}`);
