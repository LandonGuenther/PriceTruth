import type { Listing, PrismaClient } from "@prisma/client";
import type { AnalysisResponse, HistoryResponse, RetailerId } from "@pricetruth/shared";
import { RETAILERS } from "@pricetruth/shared";
import { analyzeListing, type ScoringObservation } from "@pricetruth/scoring";
import {
  PostgresPriceHistoryRepository,
  type PriceHistoryRepository,
} from "../repositories/priceHistoryRepository.js";

/**
 * Listing lookup only — all observation reads go through the
 * PriceHistoryRepository (docs/DATA_PLATFORM.md).
 */
export async function findListing(
  prisma: PrismaClient,
  retailer: string,
  externalId: string,
): Promise<Listing | null> {
  if (!(retailer in RETAILERS)) return null;
  return prisma.listing.findUnique({
    where: { retailerId_externalId: { retailerId: retailer, externalId } },
  });
}

export async function analyzeListingRow(
  repo: PriceHistoryRepository,
  listing: Listing,
): Promise<AnalysisResponse> {
  const input = await repo.getAnalysisInput(listing.id);
  const newest = input.observations[input.observations.length - 1];
  const result = analyzeListing({
    observations: input.observations,
    asOf: new Date(),
    currency: input.currency ?? "USD",
  });

  return {
    retailer: listing.retailerId as RetailerId,
    externalId: listing.externalId,
    title: listing.title,
    url: listing.url,
    currency: input.currency ?? "USD",
    currentPriceCents: newest?.priceCents ?? 0,
    referencePriceCents: newest?.referencePriceCents ?? null,
    effectiveAt: newest?.effectiveAt ?? new Date(0).toISOString(),
    typical: result.typical,
    stats: result.stats,
    confidence: result.confidence,
    discountIntegrity: result.discountIntegrity,
    dealScore: result.dealScore,
    evidence: input.evidence,
    computedAt: new Date().toISOString(),
  };
}

export async function listingHistory(
  repo: PriceHistoryRepository,
  listing: Listing,
  days: number,
): Promise<HistoryResponse> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await repo.getHistory(listing.id, { since: cutoff });
  const daily = await repo.getDailyHistory(listing.id, { since: cutoff });

  return {
    retailer: listing.retailerId as RetailerId,
    externalId: listing.externalId,
    days,
    points: rows.map((o) => ({
      effectiveAt: o.effectiveAt.toISOString(),
      priceCents: o.priceCents,
      referencePriceCents: o.referencePriceCents,
      source: o.dataSource.key,
    })),
    daily: daily.map((p) => ({ day: p.day, medianPriceCents: p.medianPriceCents })),
  };
}

/** Shared repository instance factory used by the routes. */
export function defaultHistoryRepository(prisma: PrismaClient): PriceHistoryRepository {
  return new PostgresPriceHistoryRepository(prisma);
}

// Re-export for callers that still type against the old shape.
export type { ScoringObservation };
