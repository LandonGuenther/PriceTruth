import type { PrismaClient, Listing, PriceObservation } from "@prisma/client";
import type { AnalysisResponse, HistoryResponse, RetailerId } from "@pricetruth/shared";
import { RETAILERS } from "@pricetruth/shared";
import {
  analyzeListing,
  collapseToDailySeries,
  type ScoringObservation,
} from "@pricetruth/scoring";

export type ListingWithObservations = Listing & { observations: PriceObservation[] };

export async function findListing(
  prisma: PrismaClient,
  retailer: string,
  externalId: string,
): Promise<ListingWithObservations | null> {
  if (!(retailer in RETAILERS)) return null;
  return prisma.listing.findUnique({
    where: { retailerId_externalId: { retailerId: retailer, externalId } },
    include: {
      observations: { where: { synthetic: false }, orderBy: { observedAt: "asc" } },
    },
  });
}

function toScoring(obs: PriceObservation): ScoringObservation {
  return {
    priceCents: obs.priceCents,
    referencePriceCents: obs.referencePriceCents,
    observedAt: obs.observedAt.toISOString(),
    source: obs.source,
  };
}

export function analyzeListingRow(listing: ListingWithObservations): AnalysisResponse {
  const newest = listing.observations[listing.observations.length - 1];
  const result = analyzeListing({
    observations: listing.observations.map(toScoring),
    asOf: new Date(),
    currency: newest?.currency ?? "USD",
  });

  return {
    retailer: listing.retailerId as RetailerId,
    externalId: listing.externalId,
    title: listing.title,
    url: listing.url,
    currency: newest?.currency ?? "USD",
    currentPriceCents: newest?.priceCents ?? 0,
    referencePriceCents: newest?.referencePriceCents ?? null,
    observedAt: newest?.observedAt.toISOString() ?? new Date(0).toISOString(),
    typical: result.typical,
    stats: result.stats,
    confidence: result.confidence,
    discountIntegrity: result.discountIntegrity,
    dealScore: result.dealScore,
    computedAt: new Date().toISOString(),
  };
}

export function listingHistory(listing: ListingWithObservations, days: number): HistoryResponse {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const points = listing.observations
    .filter((o) => o.observedAt >= cutoff)
    .map((o) => ({
      observedAt: o.observedAt.toISOString(),
      priceCents: o.priceCents,
      referencePriceCents: o.referencePriceCents,
      source: o.source,
    }));

  const daily = collapseToDailySeries(
    listing.observations.filter((o) => o.observedAt >= cutoff).map(toScoring),
  ).map((p) => ({ day: p.day, medianPriceCents: p.medianPriceCents }));

  return {
    retailer: listing.retailerId as RetailerId,
    externalId: listing.externalId,
    days,
    points,
    daily,
  };
}
