import type {
  ObservationStatus,
  Prisma,
  PrismaClient,
  PriceObservation,
  PriceType,
} from "@prisma/client";
import type { AnalysisResponse } from "@pricetruth/shared";
import {
  collapseToDailySeries,
  ELIGIBLE_PRICE_TYPES,
  ELIGIBLE_STATUSES,
  ineligibilityReason,
  type DailyPoint,
  type ScoringObservation,
} from "@pricetruth/scoring";

/** An observation row joined with its DataSource key — the read unit for history. */
export type HistoryObservation = PriceObservation & { dataSource: { key: string } };

export type EvidenceSummary = AnalysisResponse["evidence"];

export interface PriceHistoryRepository {
  /** Newest eligible observation, or null. */
  getCurrentObservation(listingId: string): Promise<HistoryObservation | null>;
  /** Eligible observations with effectiveAt >= since, ascending. */
  getHistory(listingId: string, opts: { since: Date }): Promise<HistoryObservation[]>;
  /** Daily-median series over eligible raw rows (see docs/DATA_PLATFORM.md). */
  getDailyHistory(listingId: string, opts: { since: Date }): Promise<DailyPoint[]>;
  getAnalysisInput(listingId: string): Promise<{
    observations: ScoringObservation[];
    currency: string | null;
    evidence: EvidenceSummary;
  }>;
}

const ELIGIBLE_WHERE: Prisma.PriceObservationWhereInput = {
  synthetic: false,
  status: { in: [...ELIGIBLE_STATUSES] as ObservationStatus[] },
  priceType: { in: [...ELIGIBLE_PRICE_TYPES] as PriceType[] },
};

function toScoring(o: HistoryObservation): ScoringObservation {
  return {
    priceCents: o.priceCents,
    referencePriceCents: o.referencePriceCents,
    effectiveAt: o.effectiveAt.toISOString(),
    sourceKey: o.dataSource.key,
  };
}

export class PostgresPriceHistoryRepository implements PriceHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getCurrentObservation(listingId: string): Promise<HistoryObservation | null> {
    return this.prisma.priceObservation.findFirst({
      where: { listingId, ...ELIGIBLE_WHERE },
      orderBy: { effectiveAt: "desc" },
      include: { dataSource: { select: { key: true } } },
    });
  }

  async getHistory(listingId: string, opts: { since: Date }): Promise<HistoryObservation[]> {
    return this.prisma.priceObservation.findMany({
      where: { listingId, effectiveAt: { gte: opts.since }, ...ELIGIBLE_WHERE },
      orderBy: { effectiveAt: "asc" },
      include: { dataSource: { select: { key: true } } },
    });
  }

  async getDailyHistory(listingId: string, opts: { since: Date }): Promise<DailyPoint[]> {
    const rows = await this.getHistory(listingId, opts);
    // IMPLEMENTED: computed on demand from raw rows. Reading ListingDailyPrice
    // instead is PLANNED (see docs/DATA_PLATFORM.md / SCALE_TRIGGERS).
    return collapseToDailySeries(rows.map(toScoring));
  }

  async getAnalysisInput(listingId: string): Promise<{
    observations: ScoringObservation[];
    currency: string | null;
    evidence: EvidenceSummary;
  }> {
    const rows = await this.prisma.priceObservation.findMany({
      where: { listingId, ...ELIGIBLE_WHERE },
      orderBy: { effectiveAt: "asc" },
      include: { dataSource: { select: { key: true } } },
    });
    const groups = await this.prisma.priceObservation.groupBy({
      by: ["status", "synthetic", "priceType"],
      where: { listingId },
      _count: { _all: true },
    });
    const evidence: EvidenceSummary = {
      eligibleCount: 0,
      excluded: { synthetic: 0, quarantined: 0, excluded: 0, priceType: 0 },
    };
    const bucket = {
      synthetic: "synthetic",
      status_quarantined: "quarantined",
      status_excluded: "excluded",
      price_type: "priceType",
    } as const;
    for (const g of groups) {
      const reason = ineligibilityReason({
        status: g.status,
        synthetic: g.synthetic,
        priceType: g.priceType,
      });
      if (reason === null) evidence.eligibleCount += g._count._all;
      else evidence.excluded[bucket[reason]] += g._count._all;
    }
    return {
      observations: rows.map(toScoring),
      currency: rows[rows.length - 1]?.currency ?? null,
      evidence,
    };
  }
}
