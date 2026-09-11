import type {
  ConfidenceResult,
  DiscountIntegrityResult,
  HistoricalStats,
} from "@pricetruth/shared";
import { insufficientScore } from "./dealScore.js";
import {
  nearReferenceShareReason,
  observationsReason,
  referenceAbovePercentileReason,
  round1,
  vsTypicalReason,
} from "./explain.js";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function discountIntegrityLabel(score: number): string {
  if (score >= 70) return "Strong historical support";
  if (score >= 40) return "Moderate historical support";
  if (score >= 20) return "Weak historical support";
  return "Reference price not supported by our observations";
}

export function computeDiscountIntegrity(
  stats: HistoricalStats,
  currentCents: number,
  referenceCents: number | null,
  typicalCents: number | null,
  confidence: ConfidenceResult,
  currency: string,
): DiscountIntegrityResult {
  if (confidence.level === "INSUFFICIENT") {
    return {
      ...insufficientScore(stats),
      advertisedDiscountPct: null,
      actualDiscountVsTypicalPct: null,
      reasons: [...confidence.reasons],
    };
  }

  if (referenceCents === null || referenceCents <= currentCents) {
    return {
      score: null,
      label: "No advertised discount",
      advertisedDiscountPct: null,
      actualDiscountVsTypicalPct:
        typicalCents !== null && typicalCents > 0
          ? round1((100 * (typicalCents - currentCents)) / typicalCents)
          : null,
      reasons: [
        observationsReason(stats.observationCount, stats.coverageDays),
        "No advertised reference price above the current price was observed.",
      ],
    };
  }

  const advertisedDiscountRaw = (100 * (referenceCents - currentCents)) / referenceCents;
  const actualDiscountRaw =
    typicalCents !== null && typicalCents > 0
      ? (100 * (typicalCents - currentCents)) / typicalCents
      : null;
  const advertisedDiscountPct = round1(advertisedDiscountRaw);
  const actualDiscountVsTypicalPct = actualDiscountRaw === null ? null : round1(actualDiscountRaw);

  const ratio = typicalCents !== null && typicalCents > 0 ? typicalCents / referenceCents : 0;
  const s1 = clamp01((ratio - 0.6) / 0.4) * 100;
  const s2 = stats.shareNearReference ?? 0;
  const s3 =
    advertisedDiscountRaw > 0 && actualDiscountRaw !== null
      ? clamp01(actualDiscountRaw / advertisedDiscountRaw) * 100
      : 0;

  const score = Math.round(0.4 * s1 + 0.3 * s2 + 0.3 * s3);

  const reasons: string[] = [
    observationsReason(stats.observationCount, stats.coverageDays),
    referenceAbovePercentileReason(referenceCents, stats.referencePricePercentile ?? 100, currency),
    nearReferenceShareReason(stats.shareNearReference ?? 0),
  ];
  if (typicalCents !== null && typicalCents > 0 && actualDiscountVsTypicalPct !== null) {
    reasons.push(vsTypicalReason(currentCents, typicalCents, actualDiscountVsTypicalPct, currency));
  }

  return {
    score,
    label: discountIntegrityLabel(score),
    advertisedDiscountPct,
    actualDiscountVsTypicalPct,
    reasons,
  };
}
