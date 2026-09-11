import type { Listing, PrismaClient, PriceObservation } from "@prisma/client";
import type { AnalysisResponse, HistoryResponse, RetailerId } from "@pricetruth/shared";
import { RETAILERS } from "@pricetruth/shared";
import {
  analyzeListing,
  collapseToDailySeries,
  ELIGIBLE_PRICE_TYPES,
  ELIGIBLE_STATUSES,
  ineligibilityReason,
  type ScoringObservation,
} from "@pricetruth/scoring";

type ObservationWithSource = PriceObservation & { dataSource: { key: string } };

export type ListingWithObservations = Listing & { observations: ObservationWithSource[] };

export async function findListing(
  prisma: PrismaClient,
  retailer: string,
  externalId: string,
): Promise<ListingWithObservations | null> {
  if (!(retailer in RETAILERS)) return null;
  return prisma.listing.findUnique({
    where: { retailerId_externalId: { retailerId: retailer, externalId } },
    include: {
      observations: {
        where: {
          synthetic: false,
          status: { in: [...ELIGIBLE_STATUSES] },
          priceType: { in: [...ELIGIBLE_PRICE_TYPES] },
        },
        orderBy: { effectiveAt: "asc" },
        include: { dataSource: { select: { key: true } } },
      },
    },
  });
}

function toScoring(obs: ObservationWithSource): ScoringObservation {
  return {
    priceCents: obs.priceCents,
    referencePriceCents: obs.referencePriceCents,
    effectiveAt: obs.effectiveAt.toISOString(),
    sourceKey: obs.dataSource.key,
  };
}

async function evidenceSummary(
  prisma: PrismaClient,
  listingId: string,
): Promise<AnalysisResponse["evidence"]> {
  const groups = await prisma.priceObservation.groupBy({
    by: ["status", "synthetic", "priceType"],
    where: { listingId },
    _count: { _all: true },
  });
  const evidence: AnalysisResponse["evidence"] = {
    eligibleCount: 0,
    excluded: { synthetic: 0, quarantined: 0, excluded: 0, priceType: 0 },
  };
  for (const g of groups) {
    const reason = ineligibilityReason({
      status: g.status,
      synthetic: g.synthetic,
      priceType: g.priceType,
    });
    if (reason === null) {
      evidence.eligibleCount += g._count._all;
    } else {
      const bucket = {
        synthetic: "synthetic",
        status_quarantined: "quarantined",
        status_excluded: "excluded",
        price_type: "priceType",
      } as const;
      evidence.excluded[bucket[reason]] += g._count._all;
    }
  }
  return evidence;
}

export async function analyzeListingRow(
  prisma: PrismaClient,
  listing: ListingWithObservations,
): Promise<AnalysisResponse> {
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
    effectiveAt: newest?.effectiveAt.toISOString() ?? new Date(0).toISOString(),
    typical: result.typical,
    stats: result.stats,
    confidence: result.confidence,
    discountIntegrity: result.discountIntegrity,
    dealScore: result.dealScore,
    evidence: await evidenceSummary(prisma, listing.id),
    computedAt: new Date().toISOString(),
  };
}

export function listingHistory(listing: ListingWithObservations, days: number): HistoryResponse {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const points = listing.observations
    .filter((o) => o.effectiveAt >= cutoff)
    .map((o) => ({
      effectiveAt: o.effectiveAt.toISOString(),
      priceCents: o.priceCents,
      referencePriceCents: o.referencePriceCents,
      source: o.dataSource.key,
    }));

  const daily = collapseToDailySeries(
    listing.observations.filter((o) => o.effectiveAt >= cutoff).map(toScoring),
  ).map((p) => ({ day: p.day, medianPriceCents: p.medianPriceCents }));

  return {
    retailer: listing.retailerId as RetailerId,
    externalId: listing.externalId,
    days,
    points,
    daily,
  };
}
