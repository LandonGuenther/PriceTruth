import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { describeIfDb, prisma, testConfig } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "..");
const SCRATCH = "pricetruth_migration_test";

const scratchUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for migration tests");
  const base = new URL(url);
  base.pathname = `/${SCRATCH}`;
  return base.toString();
};

function prismaCli(args: string): string {
  return execSync(`pnpm exec prisma ${args}`, {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: scratchUrl() },
    encoding: "utf8",
  });
}

async function recreateScratch(): Promise<PrismaClient> {
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await prisma.$executeRawUnsafe(`CREATE DATABASE ${SCRATCH}`);
  return new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
}

describeIfDb("migration paths", () => {
  let scratch: PrismaClient;
  beforeAll(async () => {
    scratch = await recreateScratch();
  }, 60_000);
  afterAll(async () => {
    await scratch.$disconnect();
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  });

  it("Path A: fresh DB → migrate deploy → no Prisma-managed drift", async () => {
    prismaCli("migrate deploy");
    const applied = await scratch.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at`,
    );
    expect(applied.map((m) => m.migration_name)).toEqual([
      "20260911022422_init",
      "20260911041711_data_foundation",
      "20260911064203_catalog_identity",
      "20260911064204_catalog_identity_model_backfill",
      "20260911065530_observation_trust",
      "20260911070434_daily_rollup",
      "20260911070927_archive_batches",
      "20260911162352_job_leases_and_runs",
    ]);

    // Drift check: nothing needed to reach the datamodel except objects Prisma
    // can't express (the append-only trigger/function and CHECK constraints).
    const script = prismaCli(
      "migrate diff --from-url $DATABASE_URL --to-schema-datamodel ./prisma/schema.prisma --script",
    );
    const statements = script
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("--"))
      .join("\n");
    const allowed = /pricetruth_forbid_observation_mutation|_append_only|CHECK|ADD CONSTRAINT/i;
    for (const line of statements.split(";")) {
      if (line.trim()) expect(line).toMatch(allowed);
    }
    expect(statements).not.toMatch(/ALTER TABLE|CREATE TABLE/i);
  }, 60_000);

  it("Path B: MVP schema + sample data → deploy migrates without loss", async () => {
    // reset scratch: Path A left it fully migrated
    await scratch.$disconnect();
    await prisma.$executeRawUnsafe(`DROP DATABASE ${SCRATCH}`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE ${SCRATCH}`);
    scratch = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });

    // OLD schema only
    prismaCli(
      `db execute --url "${scratchUrl()}" --file "${path.join(
        apiDir,
        "prisma/migrations/20260911022422_init/migration.sql",
      )}"`,
    );
    prismaCli("migrate resolve --applied 20260911022422_init");

    // deterministic MVP-shaped sample: 2 retailers, 3 listings, 12 observations
    const u = () => `gen_random_uuid()::text`;
    const day = 86_400_000;
    const base = Date.parse("2026-09-05T00:00:00Z");
    const src = {
      ext: "extension:content-script",
      api: "bestbuy:products-api",
    };
    const listings: Array<[string, string, string]> = [
      ["11111111-1111-1111-1111-111111111111", "amazon", "B0AAAAAA01"],
      ["22222222-2222-2222-2222-222222222222", "amazon", "B0BBBBBB02"],
      ["33333333-3333-3333-3333-333333333333", "bestbuy", "10129617"],
    ];
    for (const [id, retailerId, externalId] of listings) {
      await scratch.$executeRawUnsafe(
        `INSERT INTO "Retailer" ("id", "displayName") VALUES ($1, $1) ON CONFLICT DO NOTHING`,
        retailerId,
      );
      await scratch.$executeRawUnsafe(
        `INSERT INTO "Listing" ("id", "retailerId", "externalId", "url", "title", "updatedAt")
         VALUES ($1, $2, $3, 'https://example.com/p', 'T', CURRENT_TIMESTAMP)`,
        id,
        retailerId,
        externalId,
      );
    }
    const obs: Array<{
      l: string;
      p: number;
      r: number | null;
      s: string;
      t: number;
    }> = [];
    // 12 observations across 6 days; bestbuy listing gets the last, real-looking row
    for (let i = 0; i < 12; i++) {
      const l = i % 3 === 2 ? listings[2]![0]! : listings[i % 2]![0]!;
      const isApi = i === 11;
      obs.push({
        l,
        p: i === 11 ? 23899 : 20000 + i * 100,
        r: i === 11 ? 27499 : i % 4 === 0 ? 30000 : null,
        s: isApi ? src.api : src.ext,
        t: base + Math.floor(i / 2) * day + (i % 2) * 3600_000,
      });
    }
    for (const o of obs) {
      await scratch.$executeRawUnsafe(
        `INSERT INTO "PriceObservation"
           ("id", "listingId", "priceCents", "referencePriceCents", "currency",
            "inStock", "variant", "source", "observedAt", "receivedAt", "synthetic",
            "clientVersion")
         VALUES (${u()}, $1::text, $2, $3, 'USD', true, NULL, $4,
                 to_timestamp($5 / 1000.0), to_timestamp(($5 + 3000) / 1000.0), false, '0.1.0')`,
        o.l,
        o.p,
        o.r,
        o.s,
        o.t,
      );
    }

    const before = await scratch.priceObservation.count();
    const listingIds = await scratch.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Listing" ORDER BY "retailerId"`,
    );

    prismaCli("migrate deploy");

    const after = await scratch.priceObservation.count();
    expect(after).toBe(before);
    expect(after).toBe(12);

    // listing uuids preserved verbatim through the cast
    const afterIds = await scratch.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text AS id FROM "Listing" ORDER BY "retailerId"`,
    );
    expect(afterIds.map((r) => r.id)).toEqual(listingIds.map((r) => r.id));

    // BIGINT ids ascending in chronological (observedAt→clientObservedAt) order
    const rows = await scratch.$queryRawUnsafe<
      {
        id: bigint;
        effectiveAt: Date;
        receivedAt: Date;
        clientObservedAt: Date | null;
        clientSkewSeconds: number | null;
        referencePriceCents: number | null;
        referenceType: string | null;
        key: string;
        trustClass: string;
        priceType: string;
        status: string;
      }[]
    >(
      `SELECT o."id", o."effectiveAt", o."receivedAt", o."clientObservedAt",
              o."clientSkewSeconds", o."referencePriceCents",
              o."referenceType"::text AS "referenceType",
              s."key", s."trustClass"::text AS "trustClass", o."priceType"::text AS "priceType",
              o."status"::text AS "status"
       FROM "PriceObservation" o JOIN "DataSource" s ON s."id" = o."dataSourceId"
       ORDER BY o."id"`,
    );
    expect(rows).toHaveLength(12);
    const byChrono = [...rows].sort(
      (a, b) => a.clientObservedAt!.getTime() - b.clientObservedAt!.getTime(),
    );
    expect(rows.map((r) => r.id)).toEqual(byChrono.map((r) => r.id));
    for (const r of rows) {
      if (r.trustClass === "CLIENT_REPORTED") {
        expect(r.effectiveAt.getTime()).toBe(r.receivedAt.getTime());
        expect(r.clientSkewSeconds).toBe(-3);
      } else {
        expect(r.effectiveAt.getTime()).toBe(r.clientObservedAt!.getTime());
        expect(r.clientSkewSeconds).toBeNull();
      }
      expect(r.priceType).toBe("STANDARD");
      expect(r.status).toBe("ACCEPTED");
      expect(r.referenceType === "UNKNOWN").toBe(r.referencePriceCents !== null);
    }
    expect(rows.filter((r) => r.referenceType === "UNKNOWN").length).toBeGreaterThan(0);

    // migrated DB serves analysis
    const app = await buildApp({ prisma: scratch, config: testConfig() });
    const res = await app.inject({ method: "GET", url: "/v1/listings/bestbuy/10129617/analysis" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.currentPriceCents).toBe(23899);
    expect(body.referencePriceCents).toBe(27499);
    const bbCount = obs.filter((o) => o.l === listings[2]![0]).length;
    expect(body.stats.observationCount).toBe(bbCount);

    // catalog_identity backfill: one IdentifierAssertion per listing
    // (externalId → ASIN/BESTBUY_SKU, normalized uppercase, extension source)
    const assertions = await scratch.$queryRawUnsafe<
      { listingId: string; type: string; normalizedValue: string; valid: boolean }[]
    >(`SELECT "listingId"::text AS "listingId", "type"::text AS "type",
              "normalizedValue", "valid"
       FROM "IdentifierAssertion" ORDER BY "listingId"`);
    expect(assertions).toHaveLength(3);
    const types = new Set(assertions.map((a) => a.type));
    expect(types).toEqual(new Set(["ASIN", "BESTBUY_SKU"]));
    expect(assertions.every((a) => a.valid)).toBe(true);
    console.log("PATH_B_ANALYSIS", JSON.stringify(body, null, 2));
    await app.close();
  }, 60_000);
});
