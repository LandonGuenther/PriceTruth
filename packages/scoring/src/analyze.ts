import type {
  ConfidenceResult,
  DiscountIntegrityResult,
  HistoricalStats,
  ScoreResult,
  TypicalWindow,
} from "@pricetruth/shared";
import { computeConfidence } from "./confidence.js";
import { collapseToDailySeries } from "./daily.js";
import { computeDealScore } from "./dealScore.js";
import { computeDiscountIntegrity } from "./discountIntegrity.js";
import { computeStats } from "./stats.js";
import { computeTypical } from "./typical.js";
import type { ScoringObservation } from "./types.js";

export interface AnalyzeResult {
  stats: HistoricalStats;
  confidence: ConfidenceResult;
  typical: { cents: number | null; window: TypicalWindow };
  dealScore: ScoreResult;
  discountIntegrity: DiscountIntegrityResult;
}

/**
 * Compute stats, confidence, typical price and both scores for one listing.
 * Deterministic: pass `asOf` explicitly in tests (defaults to the newest
 * observation timestamp per SCORING.md).
 */
export function analyzeListing(input: {
  observations: ScoringObservation[];
  asOf?: Date;
  currency?: string;
}): AnalyzeResult {
  const { observations } = input;
  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const newest = sorted[sorted.length - 1];
  const asOf = input.asOf ?? (newest ? new Date(newest.observedAt) : new Date(0));
  const currency = input.currency ?? "USD";

  const stats = computeStats(observations, asOf);
  const daily = collapseToDailySeries(observations);
  const confidence = computeConfidence(stats, daily, asOf);
  const typical = computeTypical(stats);

  const currentCents = newest?.priceCents ?? 0;
  const referenceCents = newest?.referencePriceCents ?? null;

  return {
    stats,
    confidence,
    typical,
    dealScore: computeDealScore(stats, currentCents, typical.cents, confidence, currency),
    discountIntegrity: computeDiscountIntegrity(
      stats,
      currentCents,
      referenceCents,
      typical.cents,
      confidence,
      currency,
    ),
  };
}
