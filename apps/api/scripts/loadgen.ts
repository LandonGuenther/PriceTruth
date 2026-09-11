/**
 * Synthetic load generator for a DISPOSABLE database.
 *
 *   pnpm --filter @pricetruth/api loadgen --observations N [--listings L] [--as-real]
 *
 * Safety: refuses to run unless DATABASE_URL's database name ends with
 * `_load` or PRICETRUTH_ALLOW_SYNTHETIC_LOAD=1. Rows are written with
 * `synthetic = true` by default; `--as-real` writes `synthetic = false` so the
 * bench exercises real eligibility filters — only ever use it on the
 * disposable `_load` database (that is what the flag is for; the data is still
 * generated garbage).
 *
 * Deterministic: mulberry32(seed 42) — same N produces the same rows.
 */
import { PrismaClient } from "@prisma/client";
import { OBSERVATION_SOURCES, DATA_SOURCE_DEFINITIONS } from "@pricetruth/shared";
import { ingestObservation } from "../src/services/observationService.js";
import type { AppConfig } from "../src/config.js";

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

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const url = new URL(process.env.DATABASE_URL ?? "");
if (!url.pathname.endsWith("_load") && process.env.PRICETRUTH_ALLOW_SYNTHETIC_LOAD !== "1") {
  throw new Error(
    `refusing to run against ${url.pathname} — load target must be a *_load database`,
  );
}

const prisma = new PrismaClient();
const rng = mulberry32(42);

const BRANDS = [
  "Acme",
  "Globex",
  "Initech",
  "Umbrella",
  "Hooli",
  "Stark",
  "Wayne",
  "Wonka",
  "Cyberdyne",
  "Tyrell",
  "Aperture",
  "Black Mesa",
  "Weyland",
  "OCP",
  "Soylent",
  "Abstergo",
  "Massive Dynamic",
  "Virtucon",
  "Gekko",
  "Pied Piper",
];

async function main() {
  const N = Number(flag("observations") ?? "100000");
  const L = Math.max(200, Math.floor(N / 500));
  const asReal = process.argv.includes("--as-real");
  console.log(`loadgen: ${N} observations over ${L} listings (asReal=${asReal})`);

  for (const r of [
    { id: "amazon", displayName: "Amazon" },
    { id: "bestbuy", displayName: "Best Buy" },
  ]) {
    await prisma.retailer.upsert({ where: { id: r.id }, update: {}, create: r });
  }
  for (const d of DATA_SOURCE_DEFINITIONS) {
    await prisma.dataSource.upsert({
      where: { key: d.key },
      update: { displayName: d.displayName, sourceType: d.sourceType, trustClass: d.trustClass },
      create: {
        key: d.key,
        displayName: d.displayName,
        sourceType: d.sourceType,
        trustClass: d.trustClass,
      },
    });
  }
  const dsIds = {
    synthetic: (
      await prisma.dataSource.findUniqueOrThrow({
        where: { key: OBSERVATION_SOURCES.SYNTHETIC_TEST },
      })
    ).id,
    extension: (
      await prisma.dataSource.findUniqueOrThrow({
        where: { key: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT },
      })
    ).id,
  };

  // Listings + 1:1 products (bypass the match engine — direct inserts).
  const listingIds: { id: string; retailer: string; externalId: string }[] = [];
  for (let i = 0; i < L; i++) {
    const amazon = i % 2 === 0;
    const externalId = amazon ? `B0LOAD${String(i).padStart(5, "0")}` : `${9000000 + i}`;
    const product = await prisma.product.create({
      data: {
        title: `Load Product ${i}`,
        brand: BRANDS[i % BRANDS.length]!,
        modelNumber: `LM-${i}`,
      },
    });
    const listing = await prisma.listing.create({
      data: {
        retailerId: amazon ? "amazon" : "bestbuy",
        externalId,
        url: amazon
          ? `https://www.amazon.com/dp/${externalId}`
          : `https://www.bestbuy.com/site/x/${9000000 + i}.p?skuId=${9000000 + i}`,
        title: `Load Product ${i}`,
        brand: BRANDS[i % BRANDS.length]!,
        modelNumber: `LM-${i}`,
        productId: product.id,
      },
      select: { id: true },
    });
    listingIds.push({ id: listing.id, retailer: amazon ? "amazon" : "bestbuy", externalId });
  }
  console.log(`seeded ${listingIds.length} listings`);

  // Observations: random-walk around a per-listing base over the last 365 days.
  const now = Date.now();
  const yearMs = 365 * 86_400_000;
  const perListing = Math.ceil(N / L);
  const CHUNK = 10_000;
  let pending: object[] = [];
  let inserted = 0;
  const t0 = process.hrtime.bigint();
  for (const l of listingIds) {
    let price = 1_000 + Math.floor(rng() * 299_000);
    for (let j = 0; j < perListing; j++) {
      price = Math.max(1, Math.round(price * (1 + (rng() * 2 - 1) * 0.15)));
      const hasRef = rng() < 0.2;
      const ts = new Date(now - Math.floor(rng() * yearMs));
      pending.push({
        listingId: l.id,
        dataSourceId: rng() < 0.8 ? dsIds.synthetic : dsIds.extension,
        priceCents: price,
        priceType: rng() < 0.9 ? "STANDARD" : "SALE",
        referencePriceCents: hasRef ? Math.round(price * 1.25) : null,
        referenceType: hasRef ? "WAS_PRICE" : null,
        currency: "USD",
        inStock: true,
        receivedAt: ts,
        effectiveAt: ts,
        status: "ACCEPTED",
        synthetic: !asReal,
        schemaVersion: 1,
        extractorVersion: "load",
      });
      if (pending.length >= CHUNK) {
        await prisma.priceObservation.createMany({ data: pending as never });
        inserted += pending.length;
        pending = [];
      }
      if (inserted + pending.length >= N) break;
    }
    if (inserted + pending.length >= N) break;
  }
  if (pending.length) {
    await prisma.priceObservation.createMany({ data: pending as never });
    inserted += pending.length;
  }
  const bulkSec = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(
    `bulk ingestion: ${inserted} rows in ${bulkSec.toFixed(1)}s (${Math.round(inserted / bulkSec)} rows/sec)`,
  );

  // API-path ingestion timing: 200 sequential ingestObservation calls.
  const config = {
    DATABASE_URL: process.env.DATABASE_URL!,
    PORT: 0,
    HOST: "x",
    BESTBUY_API_KEY: undefined,
  } as AppConfig;
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    const l = listingIds[Math.floor(rng() * listingIds.length)]!;
    const obs = {
      retailer: l.retailer,
      externalId: l.externalId,
      url:
        l.retailer === "amazon"
          ? `https://www.amazon.com/dp/${l.externalId}`
          : `https://www.bestbuy.com/site/x/${l.externalId}.p?skuId=${l.externalId}`,
      title: `Load Product`,
      priceCents: 50_000 + Math.floor(rng() * 50_000),
      currency: "USD",
      source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
      observedAt: new Date().toISOString(),
      schemaVersion: 1 as const,
      priceType: "STANDARD" as const,
      extractorVersion: "load",
    };
    const s = process.hrtime.bigint();
    await ingestObservation(prisma, config, obs as never, { clientVersion: "load" });
    times.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
  console.log(
    `api ingest: 200 calls, p50=${p(0.5).toFixed(1)}ms p95=${p(0.95).toFixed(1)}ms max=${times[times.length - 1]!.toFixed(1)}ms`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
