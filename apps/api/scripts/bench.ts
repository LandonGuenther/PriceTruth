/**
 * Benchmark against a load database (see loadgen.ts). Refuses to run unless the
 * database name ends with `_load` or PRICETRUTH_ALLOW_SYNTHETIC_LOAD=1.
 *
 *   pnpm --filter @pricetruth/api bench
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { mpnMatchKey } from "@pricetruth/catalog";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { PostgresPriceHistoryRepository } from "../src/repositories/priceHistoryRepository.js";
import { runDailyRollupJob } from "../src/jobs/dailyRollup.js";
import { exportObservationBatches } from "../src/archive/exporter.js";
import { LocalFilesystemArchive } from "../src/archive/localFilesystem.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const url = new URL(process.env.DATABASE_URL ?? "");
if (!url.pathname.endsWith("_load") && process.env.PRICETRUTH_ALLOW_SYNTHETIC_LOAD !== "1") {
  throw new Error(`refusing to run against ${url.pathname}`);
}

const prisma = new PrismaClient();
const rng = mulberry32(42);
const stats = (name: string, times: number[]) => {
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
  console.log(
    `${name}: p50=${p(0.5).toFixed(1)}ms p95=${p(0.95).toFixed(1)}ms max=${times[times.length - 1]!.toFixed(1)}ms (n=${times.length})`,
  );
};
const time = async (fn: () => Promise<unknown>): Promise<number> => {
  const s = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - s) / 1e6;
};

async function main() {
  const total = await prisma.priceObservation.count();
  console.log(`=== bench: ${total} observations ===`);

  const all = await prisma.listing.findMany({
    select: { id: true, retailerId: true, externalId: true, gtin: true, modelNumber: true },
  });
  const sample = Array.from({ length: 50 }, () => all[Math.floor(rng() * all.length)]!);
  const repo = new PostgresPriceHistoryRepository(prisma);
  const config: AppConfig = {
    DATABASE_URL: process.env.DATABASE_URL!,
    PORT: 0,
    HOST: "127.0.0.1",
    ARCHIVE_LOCAL_DIR: "./archive",
  };
  const app = await buildApp({ prisma, config });

  stats(
    "latest",
    await Promise.all(sample.map((l) => time(() => repo.getCurrentObservation(l.id)))),
  );
  stats(
    "history90",
    await Promise.all(
      sample.map((l) =>
        time(() =>
          app.inject({
            method: "GET",
            url: `/v1/listings/${l.retailerId}/${l.externalId}/history?days=90`,
          }),
        ),
      ),
    ),
  );
  stats(
    "history180",
    await Promise.all(
      sample.map((l) =>
        time(() =>
          app.inject({
            method: "GET",
            url: `/v1/listings/${l.retailerId}/${l.externalId}/history?days=180`,
          }),
        ),
      ),
    ),
  );
  stats(
    "analysis",
    await Promise.all(
      sample.map((l) =>
        time(() =>
          app.inject({
            method: "GET",
            url: `/v1/listings/${l.retailerId}/${l.externalId}/analysis`,
          }),
        ),
      ),
    ),
  );

  // rollup over the whole DB from scratch (skipped with --skip-rollup)
  if (process.argv.includes("--skip-rollup")) {
    console.log("rollup_full: skipped (--skip-rollup)");
  } else {
    for (const j of ["rollup:observations", "rollup:status-events"]) {
      await prisma.jobCheckpoint.upsert({
        where: { jobName: j },
        create: { jobName: j, cursor: "0" },
        update: { cursor: "0" },
      });
    }
    const tRoll = process.hrtime.bigint();
    const r = await runDailyRollupJob(prisma);
    const rollSec = Number(process.hrtime.bigint() - tRoll) / 1e9;
    const dailyRows = await prisma.listingDailyPrice.count();
    console.log(
      `rollup_full: ${rollSec.toFixed(1)}s (${r.rolledDays} listing-days recomputed, ${dailyRows} rows in ListingDailyPrice)`,
    );
  }

  // identity lookup with the same OR shape as findCandidateProducts
  stats(
    "identity_lookup",
    await Promise.all(
      sample.map((l) =>
        time(() =>
          prisma.productIdentifier.findMany({
            where: {
              OR: [
                { type: { in: ["GTIN", "UPC", "EAN"] }, value: { in: ["00012345678905"] } },
                {
                  type: { in: ["MPN", "MANUFACTURER_MODEL"] },
                  value: { in: [mpnMatchKey(l.modelNumber ?? "LM-0")] },
                },
              ],
            },
          }),
        ),
      ),
    ),
  );

  // archive export, 2 batches of 50k
  const dir = mkdtempSync(path.join(tmpdir(), "pt-bench-archive-"));
  await prisma.jobCheckpoint.upsert({
    where: { jobName: "archive:observations" },
    create: { jobName: "archive:observations", cursor: "0" },
    update: { cursor: "0" },
  });
  const tA = process.hrtime.bigint();
  const ar = await exportObservationBatches(prisma, new LocalFilesystemArchive(dir), {
    batchSize: 50_000,
    maxBatches: 2,
    destination: dir,
  });
  const aSec = Number(process.hrtime.bigint() - tA) / 1e9;
  const { statSync, readdirSync } = await import("node:fs");
  let bytes = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else bytes += statSync(f).size;
    }
  };
  walk(dir);
  console.log(
    `archive_export: ${aSec.toFixed(1)}s, ${(bytes / 1e6).toFixed(1)} MB for ${ar.rows} rows ` +
      `(${(bytes / 1e6 / (ar.rows / 100_000)).toFixed(2)} MB per 100k rows) → ${dir}`,
  );

  // EXPLAIN (ANALYZE, BUFFERS)
  const l0 = sample[0]!;
  const price = await prisma.priceObservation.findFirstOrThrow({
    where: { listingId: l0.id },
    select: { priceCents: true, dataSourceId: true },
  });
  const maxId = await prisma.priceObservation.count();
  const queries: [string, string, unknown[]][] = [
    [
      "A latest",
      `SELECT * FROM "PriceObservation" WHERE "listingId" = $1::uuid AND synthetic = false
       AND status IN ('ACCEPTED','CORROBORATED') AND "priceType" IN ('STANDARD','SALE')
       ORDER BY "effectiveAt" DESC LIMIT 1`,
      [l0.id],
    ],
    [
      "B history180",
      `SELECT * FROM "PriceObservation" WHERE "listingId" = $1::uuid AND synthetic = false
       AND status IN ('ACCEPTED','CORROBORATED') AND "priceType" IN ('STANDARD','SALE')
       AND "effectiveAt" >= now() - interval '180 days' ORDER BY "effectiveAt" ASC`,
      [l0.id],
    ],
    [
      "C evidence groupBy",
      `SELECT status, synthetic, "priceType", count(*) FROM "PriceObservation"
       WHERE "listingId" = $1::uuid GROUP BY 1,2,3`,
      [l0.id],
    ],
    [
      "D dedupe probe",
      `SELECT id FROM "PriceObservation" WHERE "listingId" = $1::uuid AND "priceCents" = $2
       AND "currency" = 'USD' AND "dataSourceId" = $3::uuid
       AND "effectiveAt" >= now() - interval '1 hour' LIMIT 1`,
      [l0.id, price.priceCents, price.dataSourceId],
    ],
    [
      "E anomaly context",
      `SELECT "priceCents", currency, "effectiveAt" FROM "PriceObservation"
       WHERE "listingId" = $1::uuid AND synthetic = false AND status IN ('ACCEPTED','CORROBORATED')
       AND "priceType" IN ('STANDARD','SALE') AND "effectiveAt" >= now() - interval '30 days'
       ORDER BY "effectiveAt" DESC LIMIT 20`,
      [l0.id],
    ],
    [
      "F identity",
      `SELECT * FROM "ProductIdentifier" WHERE (type IN ('GTIN','UPC','EAN') AND value IN ('00012345678905'))
       OR (type IN ('MPN','MANUFACTURER_MODEL') AND value IN ('${mpnMatchKey(l0.modelNumber ?? "LM-0")}'))`,
      [],
    ],
    [
      "G rollup scan",
      `SELECT id, "listingId", "effectiveAt" FROM "PriceObservation" WHERE id > $1::bigint ORDER BY id LIMIT 5000`,
      [Math.floor(maxId / 2)],
    ],
  ];
  for (const [name, sql, params] of queries) {
    console.log(`\n--- plan ${name} ---`);
    const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
      ...(params as never[]),
    );
    for (const line of plan) console.log(line["QUERY PLAN"]);
  }

  const size = await prisma.$queryRawUnsafe<{ pg_size_pretty: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('"PriceObservation"'))`,
  );
  const idx = await prisma.$queryRawUnsafe<{ idx: string; size: string }[]>(
    `SELECT indexname AS idx, pg_size_pretty(pg_relation_size(('"' || indexname || '"')::regclass)) AS size
     FROM pg_indexes WHERE tablename = 'PriceObservation'`,
  );
  console.log(`\ntable+index size: ${size[0]!.pg_size_pretty}`);
  for (const i of idx) console.log(`  index ${i.idx}: ${i.size}`);
  await app.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
