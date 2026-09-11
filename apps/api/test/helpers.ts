import { describe, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { RetailerObservation } from "@pricetruth/shared";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { FetchLike } from "../src/services/bestbuyApi.js";
import type { FastifyInstance } from "fastify";

export const DATABASE_URL = process.env.DATABASE_URL;
export const itIfDb = DATABASE_URL ? it : it.skip;
export const describeIfDb = DATABASE_URL ? describe : describe.skip;

export const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  DATABASE_URL: DATABASE_URL ?? "postgresql://unused",
  PORT: 3000,
  HOST: "127.0.0.1",
  ...overrides,
});

export async function makeApp(
  config: AppConfig = testConfig(),
  fetchImpl?: FetchLike,
): Promise<FastifyInstance> {
  return buildApp({ prisma, config, fetchImpl });
}

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ObservationStatusEvent", "PriceObservation", "ListingVariant", "ListingDailyPrice", "JobCheckpoint", "ArchiveBatch", "ProductLinkEvent", "MatchEvidence", "IdentifierAssertion", "Listing", "ProductIdentifier", "Product", "ProductFamily", "Retailer" CASCADE',
  );
}

/** Migration-seeded dimension row; tests share it. */
export async function dataSourceId(key: string): Promise<string> {
  const ds = await prisma.dataSource.findUniqueOrThrow({ where: { key } });
  return ds.id;
}

export function amazonObservation(
  overrides: Partial<RetailerObservation> = {},
): RetailerObservation {
  return {
    retailer: "amazon",
    externalId: "B0TESTASIN",
    url: "https://www.amazon.com/dp/B0TESTASIN",
    title: "Test Widget",
    brand: "Acme",
    modelNumber: "AC-1",
    gtin: "0012345678905",
    priceCents: 29900,
    referencePriceCents: 49900,
    currency: "USD",
    inStock: true,
    source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
    observedAt: new Date().toISOString(),
    schemaVersion: 1,
    priceType: "STANDARD",
    referenceType: "UNKNOWN",
    extractorVersion: "1.0.0",
    ...overrides,
  };
}
