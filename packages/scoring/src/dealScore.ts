import type { ConfidenceResult, HistoricalStats, ScoreResult } from "@pricetruth/shared";
import { aboveRecordedLowReason, observationsReason, round1, vsTypicalReason } from "./explain.js";

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function dealScoreLabel(score: number): string {
  if (score >= 80) return "Historically strong price";
  if (score >= 60) return "Better than typical";
  if (score >= 40) return "Typical price";
  if (score >= 20) return "Above typical";
  return "Historically expensive price";
}

export function insufficientScore(stats: HistoricalStats): Pick<ScoreResult, "score" | "label"> {
  return {
    score: null,
    label: stats.observationCount > 0 ? "Limited history" : "Insufficient evidence",
  };
}

export function computeDealScore(
  stats: HistoricalStats,
  currentCents: number,
  typicalCents: number | null,
  confidence: ConfidenceResult,
  currency: string,
): ScoreResult {
  if (confidence.level === "INSUFFICIENT") {
    return { ...insufficientScore(stats), reasons: [...confidence.reasons] };
  }

  const pricePercentile = stats.pricePercentile ?? 0;
  const recordedLow = stats.recordedLowCents ?? currentCents;

  const s1 = 100 - pricePercentile;
  const s2 =
    typicalCents !== null && typicalCents > 0
      ? clamp(50 + ((typicalCents - currentCents) / typicalCents) * 250, 0, 100)
      : 0;
  const s3 =
    recordedLow > 0 ? clamp(100 - ((currentCents - recordedLow) / recordedLow) * 250, 0, 100) : 0;

  const score = Math.round(0.4 * s1 + 0.3 * s2 + 0.3 * s3);

  const reasons: string[] = [
    observationsReason(stats.observationCount, stats.coverageDays),
    aboveRecordedLowReason(currentCents, recordedLow, currency),
  ];
  if (typicalCents !== null && typicalCents > 0) {
    reasons.push(
      vsTypicalReason(
        currentCents,
        typicalCents,
        round1((100 * (typicalCents - currentCents)) / typicalCents),
        currency,
      ),
    );
  }

  return { score, label: dealScoreLabel(score), reasons };
}
