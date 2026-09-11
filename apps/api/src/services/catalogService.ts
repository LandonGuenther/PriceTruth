import type { Prisma, PrismaClient } from "@prisma/client";
import {
  GTIN_FAMILY,
  MATCH_ENGINE_VERSION,
  MODEL_FAMILY,
  evaluateMatch,
  mpnMatchKey,
  normalizeIdentifier,
  shouldAutoLink,
  type IdentifierKind,
  type MatchDecision,
  type NormalizedIdentifier,
} from "@pricetruth/catalog";
import type { RetailerObservation } from "@pricetruth/shared";

const AUTO_LINK_ACTOR = `auto:match-engine@${MATCH_ENGINE_VERSION}`;

const IDENTIFIER_TYPE: Record<string, "ASIN" | "BESTBUY_SKU"> = {
  amazon: "ASIN",
  bestbuy: "BESTBUY_SKU",
};

/** Identifier kinds asserted about a listing by an incoming observation. */
export function listingAssertionInputs(
  obs: RetailerObservation,
): Array<{ type: IdentifierKind; raw: string }> {
  const items: Array<{ type: IdentifierKind; raw: string }> = [
    { type: IDENTIFIER_TYPE[obs.retailer] ?? "MPN", raw: obs.externalId },
  ];
  if (obs.gtin) items.push({ type: "GTIN", raw: obs.gtin });
  if (obs.modelNumber) items.push({ type: "MANUFACTURER_MODEL", raw: obs.modelNumber });
  return items;
}

/**
 * Upsert IdentifierAssertion rows for a listing. Returns the listing's full
 * ACTIVE assertion set and whether any new (type, normalizedValue) appeared.
 */
export async function upsertAssertions(
  prisma: PrismaClient,
  listingId: string,
  items: Array<{ type: IdentifierKind; raw: string }>,
  dataSourceId: string,
): Promise<{ identifiers: NormalizedIdentifier[]; addedNew: boolean }> {
  let addedNew = false;
  for (const item of items) {
    const { normalized, valid } = normalizeIdentifier(item.type, item.raw);
    const existing = await prisma.identifierAssertion.findUnique({
      where: {
        listingId_type_normalizedValue: {
          listingId,
          type: item.type,
          normalizedValue: normalized,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.identifierAssertion.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), valid, dataSourceId },
      });
    } else {
      addedNew = true;
      await prisma.identifierAssertion.create({
        data: {
          listingId,
          type: item.type,
          rawValue: item.raw,
          normalizedValue: normalized,
          valid,
          dataSourceId,
        },
      });
    }
  }
  const all = await prisma.identifierAssertion.findMany({
    where: { listingId, status: "ACTIVE" },
    select: { type: true, normalizedValue: true, valid: true },
  });
  return {
    identifiers: all.map((a) => ({ type: a.type, value: a.normalizedValue, valid: a.valid })),
    addedNew,
  };
}

/**
 * The ProductIdentifier `value` stored for a normalized identifier. GTIN-family
 * and external-id types store the normalized value; MPN/MANUFACTURER_MODEL
 * store the match key so candidate lookup is a direct index hit (documented in
 * docs/CATALOG_IDENTITY.md).
 */
function productIdentifierValue(id: NormalizedIdentifier): string {
  return MODEL_FAMILY.has(id.type) ? mpnMatchKey(id.value) : id.value;
}

type CatalogTx = Pick<
  Prisma.TransactionClient,
  "product" | "productIdentifier" | "listing" | "productLinkEvent"
>;

async function addIdentifiersToProduct(
  prisma: CatalogTx,
  productId: string,
  identifiers: NormalizedIdentifier[],
): Promise<void> {
  for (const id of identifiers) {
    const value = productIdentifierValue(id);
    if (!value) continue;
    const conflict = await prisma.productIdentifier.findUnique({
      where: { type_value: { type: id.type, value } },
      select: { id: true },
    });
    if (conflict) continue;
    await prisma.productIdentifier.create({ data: { productId, type: id.type, value } });
  }
}

async function createProductForListing(
  tx: CatalogTx,
  listing: { title: string; brand: string | null; modelNumber: string | null },
  identifiers: NormalizedIdentifier[],
): Promise<string> {
  const product = await tx.product.create({
    data: { title: listing.title, brand: listing.brand, modelNumber: listing.modelNumber },
  });
  await addIdentifiersToProduct(
    tx,
    product.id,
    identifiers.filter((i) => i.valid),
  );
  return product.id;
}

/** Candidate products sharing any GTIN-family or model-match-key identifier. */
async function findCandidateProducts(prisma: PrismaClient, identifiers: NormalizedIdentifier[]) {
  const gtinValues = identifiers.filter((i) => GTIN_FAMILY.has(i.type)).map((i) => i.value);
  const modelKeys = identifiers
    .filter((i) => MODEL_FAMILY.has(i.type))
    .map((i) => mpnMatchKey(i.value));
  if (gtinValues.length === 0 && modelKeys.length === 0) return [];

  const rows = await prisma.productIdentifier.findMany({
    where: {
      OR: [
        { type: { in: ["GTIN", "UPC", "EAN"] }, value: { in: gtinValues } },
        { type: { in: ["MPN", "MANUFACTURER_MODEL"] }, value: { in: modelKeys } },
      ],
    },
    select: {
      product: {
        select: {
          id: true,
          title: true,
          brand: true,
          identifiers: { select: { type: true, value: true } },
        },
      },
    },
  });
  const seen = new Map<string, (typeof rows)[number]["product"]>();
  for (const r of rows) seen.set(r.product.id, r.product);
  return [...seen.values()].map((p) => ({
    productId: p.id,
    title: p.title,
    brand: p.brand ?? undefined,
    identifiers: p.identifiers.map((i) => ({
      type: i.type as IdentifierKind,
      value: i.value,
      valid: true,
    })),
  }));
}

async function recordEvidence(
  prisma: PrismaClient,
  listingId: string,
  decision: MatchDecision,
): Promise<void> {
  await prisma.matchEvidence.create({
    data: {
      listingId,
      candidateProductId: decision.productId,
      level: decision.level,
      reasons: decision.reasons,
      engineVersion: MATCH_ENGINE_VERSION,
    },
  });
}

/**
 * Full identity flow for a NEW listing row (created with productId null):
 * assertions → match → auto-link (EXACT/HIGH) or fresh 1:1 Product.
 * `identifiers` must be the listing's active assertion set.
 */
export async function identifyNewListing(
  prisma: PrismaClient,
  listing: { id: string; title: string; brand: string | null; modelNumber: string | null },
  identifiers: NormalizedIdentifier[],
): Promise<string> {
  const candidates = await findCandidateProducts(prisma, identifiers);
  const decision = evaluateMatch(
    { identifiers, brand: listing.brand ?? undefined, title: listing.title },
    candidates,
  );
  await recordEvidence(prisma, listing.id, decision);

  if (decision.productId && shouldAutoLink(decision.level)) {
    const productId = decision.productId;
    await prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id: listing.id }, data: { productId } });
      await tx.productLinkEvent.create({
        data: {
          listingId: listing.id,
          action: "LINK",
          previousProductId: null,
          newProductId: productId,
          reason: `match:${decision.level}`,
          actor: AUTO_LINK_ACTOR,
        },
      });
    });
    // The linked product may still be missing identifiers the new listing asserts.
    await addIdentifiersToProduct(
      prisma,
      productId,
      identifiers.filter((i) => i.valid),
    );
    return productId;
  }

  // No linkable product — create the fallback 1:1 Product and attach it.
  const productId = await createProductForListing(prisma, listing, identifiers);
  await prisma.listing.update({ where: { id: listing.id }, data: { productId } });
  return productId;
}

/**
 * For an EXISTING listing: record fresh evidence only. Never auto-relinks an
 * already-linked listing — REVIEW/CONFLICT evidence is the audit trail.
 */
export async function reevaluateListing(
  prisma: PrismaClient,
  listing: { id: string; title: string; brand: string | null },
  identifiers: NormalizedIdentifier[],
): Promise<void> {
  const candidates = await findCandidateProducts(prisma, identifiers);
  const decision = evaluateMatch(
    { identifiers, brand: listing.brand ?? undefined, title: listing.title },
    candidates,
  );
  await recordEvidence(prisma, listing.id, decision);
}

/** Manual link — writes an auditable ProductLinkEvent. */
export async function linkListing(
  prisma: PrismaClient,
  args: { listingId: string; productId: string; reason: string; actor: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUniqueOrThrow({
      where: { id: args.listingId },
      select: { productId: true },
    });
    if (listing.productId === args.productId) return;
    await tx.listing.update({
      where: { id: args.listingId },
      data: { productId: args.productId },
    });
    await tx.productLinkEvent.create({
      data: {
        listingId: args.listingId,
        action: "LINK",
        previousProductId: listing.productId,
        newProductId: args.productId,
        reason: args.reason,
        actor: args.actor,
      },
    });
  });
}

/** Manual unlink — detaches to a fresh 1:1 Product and writes the event. */
export async function unlinkListing(
  prisma: PrismaClient,
  args: { listingId: string; reason: string; actor: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUniqueOrThrow({
      where: { id: args.listingId },
      select: { productId: true, title: true, brand: true, modelNumber: true },
    });
    const assertions = await tx.identifierAssertion.findMany({
      where: { listingId: args.listingId, status: "ACTIVE", valid: true },
      select: { type: true, normalizedValue: true },
    });
    const productId = await createProductForListing(
      tx,
      listing,
      assertions.map((a) => ({ type: a.type, value: a.normalizedValue, valid: true })),
    );
    await tx.listing.update({ where: { id: args.listingId }, data: { productId } });
    await tx.productLinkEvent.create({
      data: {
        listingId: args.listingId,
        action: "UNLINK",
        previousProductId: listing.productId,
        newProductId: productId,
        reason: args.reason,
        actor: args.actor,
      },
    });
  });
}
