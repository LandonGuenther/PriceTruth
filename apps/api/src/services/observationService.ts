import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OBSERVATION_SOURCES, RETAILERS, type RetailerObservation } from "@pricetruth/shared";
import type { AppConfig } from "../config.js";
import { fetchBestBuyProduct, type FetchLike } from "./bestbuyApi.js";

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const IDENTIFIER_TYPE: Record<string, "ASIN" | "BESTBUY_SKU"> = {
  amazon: "ASIN",
  bestbuy: "BESTBUY_SKU",
};

export function userAgentHash(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  return createHash("sha256").update(userAgent).digest("hex");
}

export class ObservationRejected extends Error {
  readonly statusCode = 400;
}

export interface IngestResult {
  accepted: boolean;
  duplicate: boolean;
  listingId: string;
  observationId: string;
  enrichment: { bestbuyApi: "recorded" | "duplicate" | "skipped" | "disabled" | "error" };
}

async function upsertListing(
  prisma: PrismaClient,
  obs: RetailerObservation,
): Promise<{ id: string }> {
  const retailerId = obs.retailer;
  await prisma.retailer.upsert({
    where: { id: retailerId },
    update: {},
    create: { id: retailerId, displayName: RETAILERS[retailerId].displayName },
  });

  const key = { retailerId, externalId: obs.externalId };
  const existing = await prisma.listing.findUnique({
    where: { retailerId_externalId: key },
    select: { id: true },
  });
  if (existing) {
    // Listing metadata may be refreshed to the newest observed values.
    await prisma.listing.update({
      where: { id: existing.id },
      data: {
        url: obs.url,
        title: obs.title,
        brand: obs.brand ?? null,
        modelNumber: obs.modelNumber ?? null,
        gtin: obs.gtin ?? null,
      },
    });
    return existing;
  }

  // MVP: create a Product 1:1 per new Listing (no cross-retailer merging yet).
  const product = await prisma.product.create({
    data: { title: obs.title, brand: obs.brand ?? null, modelNumber: obs.modelNumber ?? null },
  });

  const identifiers: Prisma.ProductIdentifierCreateManyInput[] = [
    { productId: product.id, type: IDENTIFIER_TYPE[retailerId] ?? "MPN", value: obs.externalId },
  ];
  if (obs.gtin) {
    // A GTIN may already belong to another product — on conflict, skip linking.
    const conflict = await prisma.productIdentifier.findUnique({
      where: { type_value: { type: "GTIN", value: obs.gtin } },
      select: { id: true },
    });
    if (!conflict) {
      identifiers.push({ productId: product.id, type: "GTIN", value: obs.gtin });
    }
  }
  await prisma.productIdentifier.createMany({ data: identifiers });

  return prisma.listing.create({
    data: {
      retailerId,
      externalId: obs.externalId,
      url: obs.url,
      title: obs.title,
      brand: obs.brand ?? null,
      modelNumber: obs.modelNumber ?? null,
      gtin: obs.gtin ?? null,
      productId: product.id,
    },
    select: { id: true },
  });
}

interface ObservationFields {
  priceCents: number;
  referencePriceCents: number | null;
  currency: string;
  inStock: boolean | null;
  variant: Record<string, string> | null;
  source: string;
  observedAt: Date;
}

async function findDuplicate(prisma: PrismaClient, listingId: string, fields: ObservationFields) {
  return prisma.priceObservation.findFirst({
    where: {
      listingId,
      priceCents: fields.priceCents,
      referencePriceCents: fields.referencePriceCents,
      currency: fields.currency,
      source: fields.source,
      observedAt: {
        gte: new Date(fields.observedAt.getTime() - DEDUP_WINDOW_MS),
        lte: new Date(fields.observedAt.getTime() + DEDUP_WINDOW_MS),
      },
    },
    orderBy: { observedAt: "desc" },
    select: { id: true },
  });
}

async function insertObservation(
  prisma: PrismaClient,
  listingId: string,
  fields: ObservationFields,
  meta: { clientVersion: string | null; userAgentHash: string | null },
) {
  return prisma.priceObservation.create({
    data: {
      listingId,
      priceCents: fields.priceCents,
      referencePriceCents: fields.referencePriceCents,
      currency: fields.currency,
      inStock: fields.inStock,
      variant: fields.variant === null ? Prisma.JsonNull : fields.variant,
      source: fields.source,
      observedAt: fields.observedAt,
      synthetic: false,
      clientVersion: meta.clientVersion,
      userAgentHash: meta.userAgentHash,
    },
    select: { id: true },
  });
}

export async function ingestObservation(
  prisma: PrismaClient,
  config: Pick<AppConfig, "BESTBUY_API_KEY">,
  obs: RetailerObservation,
  meta: { clientVersion: string | null; userAgentHash: string | null },
  fetchImpl?: FetchLike,
): Promise<IngestResult> {
  const observedAt = new Date(obs.observedAt);
  const now = Date.now();
  if (observedAt.getTime() - now > MAX_FUTURE_MS) {
    throw new ObservationRejected("observedAt is more than 10 minutes in the future");
  }
  if (now - observedAt.getTime() > MAX_AGE_MS) {
    throw new ObservationRejected("observedAt is older than 7 days");
  }

  const listing = await upsertListing(prisma, obs);

  const fields: ObservationFields = {
    priceCents: obs.priceCents,
    referencePriceCents: obs.referencePriceCents ?? null,
    currency: obs.currency,
    inStock: obs.inStock ?? null,
    variant: obs.variant ?? null,
    source: obs.source,
    observedAt,
  };

  const existing = await findDuplicate(prisma, listing.id, fields);
  let observationId: string;
  let accepted: boolean;
  if (existing) {
    observationId = existing.id;
    accepted = false;
  } else {
    observationId = (await insertObservation(prisma, listing.id, fields, meta)).id;
    accepted = true;
  }

  const enrichment = await maybeEnrichBestBuy(prisma, config, listing.id, obs, meta, fetchImpl);

  return {
    accepted,
    duplicate: !accepted,
    listingId: listing.id,
    observationId,
    enrichment: { bestbuyApi: enrichment },
  };
}

async function maybeEnrichBestBuy(
  prisma: PrismaClient,
  config: Pick<AppConfig, "BESTBUY_API_KEY">,
  listingId: string,
  obs: RetailerObservation,
  meta: { clientVersion: string | null; userAgentHash: string | null },
  fetchImpl?: FetchLike,
): Promise<"recorded" | "duplicate" | "skipped" | "disabled" | "error"> {
  if (obs.retailer !== "bestbuy") return "skipped";
  if (!config.BESTBUY_API_KEY) return "disabled";

  const now = Date.now();
  try {
    // Respect Best Buy's rate limits: never call the API if we recorded an
    // enrichment row for this listing within the last 60 minutes.
    const recent = await prisma.priceObservation.findFirst({
      where: {
        listingId,
        source: OBSERVATION_SOURCES.BESTBUY_API,
        observedAt: {
          gte: new Date(now - DEDUP_WINDOW_MS),
          lte: new Date(now + DEDUP_WINDOW_MS),
        },
      },
      select: { id: true },
    });
    if (recent) return "duplicate";

    const info = await fetchBestBuyProduct(obs.externalId, config.BESTBUY_API_KEY, fetchImpl);
    if (!info) return "error";

    const fields: ObservationFields = {
      priceCents: info.priceCents,
      referencePriceCents: info.referencePriceCents,
      currency: "USD",
      inStock: info.inStock,
      variant: null,
      source: OBSERVATION_SOURCES.BESTBUY_API,
      observedAt: new Date(now),
    };
    const dup = await findDuplicate(prisma, listingId, fields);
    if (dup) return "duplicate";
    await insertObservation(prisma, listingId, fields, meta);
    return "recorded";
  } catch {
    return "error";
  }
}
