import { createHash } from "node:crypto";
import {
  type ObservationStatus,
  type PrismaClient,
  type PriceType as PrismaPriceType,
  type ReferencePriceType as PrismaReferencePriceType,
} from "@prisma/client";
import {
  OBSERVATION_SOURCES,
  RETAILERS,
  type PriceType,
  type ReferencePriceType,
  type RetailerObservation,
} from "@pricetruth/shared";
import type { AppConfig } from "../config.js";
import { fetchBestBuyProduct, type FetchLike } from "./bestbuyApi.js";
import {
  identifyNewListing,
  listingAssertionInputs,
  reevaluateListing,
  upsertAssertions,
} from "./catalogService.js";
import { resolveObservationTime } from "./timePolicy.js";

const DEDUP_WINDOW_MS = 60 * 60 * 1000;

// Type-level proof that the shared literals and the Prisma enums are identical.
const priceTypeMap = {
  STANDARD: "STANDARD",
  SALE: "SALE",
  MEMBER: "MEMBER",
  SUBSCRIPTION: "SUBSCRIPTION",
  COUPON_REQUIRED: "COUPON_REQUIRED",
  INSTALLMENT: "INSTALLMENT",
  USED: "USED",
  REFURBISHED: "REFURBISHED",
  MARKETPLACE: "MARKETPLACE",
  UNKNOWN: "UNKNOWN",
} satisfies Record<PriceType, PrismaPriceType>;

const referenceTypeMap = {
  WAS_PRICE: "WAS_PRICE",
  LIST_PRICE: "LIST_PRICE",
  MSRP: "MSRP",
  COMP_VALUE: "COMP_VALUE",
  REGULAR_PRICE: "REGULAR_PRICE",
  UNKNOWN: "UNKNOWN",
} satisfies Record<ReferencePriceType, PrismaReferencePriceType>;

export class ObservationRejected extends Error {
  readonly statusCode = 400;
}

export interface IngestResult {
  accepted: boolean;
  duplicate: boolean;
  listingId: string;
  /** BigInt primary key serialised as a decimal string. */
  observationId: string;
  enrichment: { bestbuyApi: "recorded" | "duplicate" | "skipped" | "disabled" | "error" };
}

async function upsertListing(
  prisma: PrismaClient,
  obs: RetailerObservation,
  dataSourceId: string,
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
    select: { id: true, title: true, brand: true },
  });
  const assertionItems = listingAssertionInputs(obs);

  if (existing) {
    // Listing metadata may be refreshed to the newest observed values.
    const updated = await prisma.listing.update({
      where: { id: existing.id },
      data: {
        url: obs.url,
        title: obs.title,
        brand: obs.brand ?? null,
        modelNumber: obs.modelNumber ?? null,
        gtin: obs.gtin ?? null,
      },
      select: { id: true, title: true, brand: true },
    });
    const { identifiers, addedNew } = await upsertAssertions(
      prisma,
      existing.id,
      assertionItems,
      dataSourceId,
    );
    // New identifier evidence re-runs the match for the audit log, but an
    // already-linked listing is never auto-relinked.
    if (addedNew) {
      await reevaluateListing(prisma, updated, identifiers);
    }
    return { id: existing.id };
  }

  const listing = await prisma.listing.create({
    data: {
      retailerId,
      externalId: obs.externalId,
      url: obs.url,
      title: obs.title,
      brand: obs.brand ?? null,
      modelNumber: obs.modelNumber ?? null,
      gtin: obs.gtin ?? null,
    },
    select: { id: true, title: true, brand: true, modelNumber: true },
  });

  // Assertions first, then the match engine decides the product link.
  const { identifiers } = await upsertAssertions(prisma, listing.id, assertionItems, dataSourceId);
  await identifyNewListing(prisma, listing, identifiers);
  return { id: listing.id };
}

/** Canonical JSON fingerprint: sha256 of entries sorted by key. */
export function variantFingerprint(attributes: Record<string, string>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b))),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

async function upsertVariant(
  prisma: PrismaClient,
  listingId: string,
  attributes: Record<string, string>,
): Promise<string> {
  const fingerprint = variantFingerprint(attributes);
  const existing = await prisma.listingVariant.findUnique({
    where: { listingId_fingerprint: { listingId, fingerprint } },
    select: { id: true },
  });
  if (existing) return existing.id;
  return (
    await prisma.listingVariant.create({
      data: { listingId, fingerprint, attributes },
      select: { id: true },
    })
  ).id;
}

interface ObservationFields {
  priceCents: number;
  priceType: PriceType;
  referencePriceCents: number | null;
  referenceType: ReferencePriceType | null;
  currency: string;
  inStock: boolean | null;
  variantId: string | null;
  dataSourceId: string;
  schemaVersion: number;
  extractorVersion: string | null;
  clientObservedAt: Date | null;
  receivedAt: Date;
  effectiveAt: Date;
  clientSkewSeconds: number | null;
  synthetic: boolean;
}

async function findDuplicate(prisma: PrismaClient, listingId: string, fields: ObservationFields) {
  return prisma.priceObservation.findFirst({
    where: {
      listingId,
      priceCents: fields.priceCents,
      referencePriceCents: fields.referencePriceCents,
      currency: fields.currency,
      dataSourceId: fields.dataSourceId,
      effectiveAt: {
        gte: new Date(fields.effectiveAt.getTime() - DEDUP_WINDOW_MS),
        lte: new Date(fields.effectiveAt.getTime() + DEDUP_WINDOW_MS),
      },
    },
    orderBy: { effectiveAt: "desc" },
    select: { id: true },
  });
}

async function insertObservation(
  prisma: PrismaClient,
  listingId: string,
  fields: ObservationFields,
  meta: { clientVersion: string | null },
) {
  return prisma.priceObservation.create({
    data: {
      listingId,
      variantId: fields.variantId,
      dataSourceId: fields.dataSourceId,
      priceCents: fields.priceCents,
      priceType: priceTypeMap[fields.priceType],
      referencePriceCents: fields.referencePriceCents,
      referenceType: fields.referenceType === null ? null : referenceTypeMap[fields.referenceType],
      currency: fields.currency,
      inStock: fields.inStock,
      receivedAt: fields.receivedAt,
      clientObservedAt: fields.clientObservedAt,
      effectiveAt: fields.effectiveAt,
      clientSkewSeconds: fields.clientSkewSeconds,
      status: "ACCEPTED",
      synthetic: fields.synthetic,
      schemaVersion: fields.schemaVersion,
      clientVersion: meta.clientVersion,
      extractorVersion: fields.extractorVersion,
    },
    select: { id: true },
  });
}

export async function ingestObservation(
  prisma: PrismaClient,
  config: Pick<AppConfig, "BESTBUY_API_KEY">,
  obs: RetailerObservation,
  meta: { clientVersion: string | null },
  fetchImpl?: FetchLike,
): Promise<IngestResult> {
  const dataSource = await prisma.dataSource.findUnique({ where: { key: obs.source } });
  if (!dataSource) {
    throw new ObservationRejected(`unknown source: ${obs.source}`);
  }
  // Only untrusted-client sources may be claimed over the wire; claiming a
  // SERVER_FETCHED/VERIFIED/TEST source would hand the client a trusted clock
  // or let it inject synthetic rows.
  if (dataSource.trustClass !== "CLIENT_REPORTED") {
    throw new ObservationRejected(`source is not accepted from clients: ${obs.source}`);
  }

  const receivedAt = new Date();
  const resolved = resolveObservationTime({
    trustClass: dataSource.trustClass,
    clientObservedAt: new Date(obs.observedAt),
    receivedAt,
  });
  if (resolved.rejectReason) throw new ObservationRejected(resolved.rejectReason);
  const { effectiveAt, clientSkewSeconds } = resolved;

  const listing = await upsertListing(prisma, obs, dataSource.id);

  const variantId =
    obs.variant && Object.keys(obs.variant).length > 0
      ? await upsertVariant(prisma, listing.id, obs.variant)
      : null;

  const fields: ObservationFields = {
    priceCents: obs.priceCents,
    priceType: obs.priceType,
    referencePriceCents: obs.referencePriceCents ?? null,
    referenceType: obs.referenceType ?? null,
    currency: obs.currency,
    inStock: obs.inStock ?? null,
    variantId,
    dataSourceId: dataSource.id,
    schemaVersion: obs.schemaVersion,
    extractorVersion: obs.extractorVersion ?? null,
    clientObservedAt: new Date(obs.observedAt),
    receivedAt,
    effectiveAt,
    clientSkewSeconds,
    synthetic: false,
  };

  const existing = await findDuplicate(prisma, listing.id, fields);
  let observationId: bigint;
  let accepted: boolean;
  if (existing) {
    observationId = existing.id;
    accepted = false;
  } else {
    observationId = (await insertObservation(prisma, listing.id, fields, meta)).id;
    accepted = true;
  }

  const enrichment = await maybeEnrichBestBuy(prisma, config, listing.id, obs, fetchImpl);

  return {
    accepted,
    duplicate: !accepted,
    listingId: listing.id,
    observationId: observationId.toString(),
    enrichment: { bestbuyApi: enrichment },
  };
}

async function maybeEnrichBestBuy(
  prisma: PrismaClient,
  config: Pick<AppConfig, "BESTBUY_API_KEY">,
  listingId: string,
  obs: RetailerObservation,
  fetchImpl?: FetchLike,
): Promise<"recorded" | "duplicate" | "skipped" | "disabled" | "error"> {
  if (obs.retailer !== "bestbuy") return "skipped";
  if (!config.BESTBUY_API_KEY) return "disabled";

  const now = new Date();
  try {
    const dataSource = await prisma.dataSource.findUnique({
      where: { key: OBSERVATION_SOURCES.BESTBUY_API },
    });
    if (!dataSource) return "error";

    // Respect Best Buy's rate limits: never call the API if we recorded an
    // enrichment row for this listing within the last 60 minutes.
    const recent = await prisma.priceObservation.findFirst({
      where: {
        listingId,
        dataSourceId: dataSource.id,
        effectiveAt: {
          gte: new Date(now.getTime() - DEDUP_WINDOW_MS),
          lte: new Date(now.getTime() + DEDUP_WINDOW_MS),
        },
      },
      select: { id: true },
    });
    if (recent) return "duplicate";

    const info = await fetchBestBuyProduct(obs.externalId, config.BESTBUY_API_KEY, fetchImpl);
    if (!info) return "error";

    const { effectiveAt, clientSkewSeconds } = resolveObservationTime({
      trustClass: dataSource.trustClass,
      clientObservedAt: now,
      receivedAt: now,
    });
    const fields: ObservationFields = {
      priceCents: info.priceCents,
      priceType: "STANDARD",
      referencePriceCents: info.referencePriceCents,
      // The official API field is literally `regularPrice` — documented semantic.
      referenceType: info.referencePriceCents === null ? null : "REGULAR_PRICE",
      currency: "USD",
      inStock: info.inStock,
      variantId: null,
      dataSourceId: dataSource.id,
      schemaVersion: 1,
      extractorVersion: null,
      clientObservedAt: now,
      receivedAt: now,
      effectiveAt,
      clientSkewSeconds,
      synthetic: false,
    };
    const dup = await findDuplicate(prisma, listingId, fields);
    if (dup) return "duplicate";
    await insertObservation(prisma, listingId, fields, { clientVersion: null });
    return "recorded";
  } catch {
    return "error";
  }
}

/**
 * The ONLY write path allowed to mutate an existing observation: flips `status`
 * and appends an ObservationStatusEvent in one transaction. Ops/internal only —
 * no route exposes it.
 */
export async function setObservationStatus(
  prisma: PrismaClient,
  observationId: bigint,
  toStatus: ObservationStatus,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.priceObservation.findUniqueOrThrow({
      where: { id: observationId },
      select: { status: true },
    });
    if (current.status === toStatus) return;
    await tx.priceObservation.update({
      where: { id: observationId },
      data: { status: toStatus },
    });
    await tx.observationStatusEvent.create({
      data: { observationId, fromStatus: current.status, toStatus, reason },
    });
  });
}
