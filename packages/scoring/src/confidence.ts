import type { ConfidenceLevel, ConfidenceResult, HistoricalStats } from "@pricetruth/shared";
import type { DailyPoint } from "./types.js";

const LEVELS: ConfidenceLevel[] = ["INSUFFICIENT", "LOW", "MEDIUM", "HIGH"];

const STALENESS_DAYS = 14;
const DISPERSION_THRESHOLD = 0.5;

/** Median of the lower half of the sorted values. */
function quartile(sorted: number[], lower: boolean): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const half = lower ? sorted.slice(0, Math.floor(n / 2)) : sorted.slice(Math.ceil(n / 2));
  if (half.length === 0) return null;
  const mid = Math.floor(half.length / 2);
  if (half.length % 2 === 1) return half[mid] ?? null;
  return Math.round(((half[mid - 1] ?? 0) + (half[mid] ?? 0)) / 2);
}

export function computeConfidence(
  stats: HistoricalStats,
  daily: DailyPoint[],
  asOf: Date,
): ConfidenceResult {
  const reasons: string[] = [];

  let level: ConfidenceLevel;
  if (stats.observationCount < 3 || stats.uniqueDays < 3 || stats.coverageDays < 7) {
    level = "INSUFFICIENT";
    reasons.push(
      `Not enough history yet: ${stats.observationCount} observations across ${stats.uniqueDays} distinct days over a ${stats.coverageDays}-day window.`,
    );
  } else if (stats.uniqueDays < 10 || stats.coverageDays < 30) {
    level = "LOW";
    reasons.push(
      `Limited history: ${stats.uniqueDays} distinct days observed over a ${stats.coverageDays}-day window.`,
    );
  } else if (stats.uniqueDays < 30 || stats.coverageDays < 90) {
    level = "MEDIUM";
    reasons.push(
      `Moderate history: ${stats.uniqueDays} distinct days observed over a ${stats.coverageDays}-day window.`,
    );
  } else {
    level = "HIGH";
    reasons.push(
      `Strong history: ${stats.uniqueDays} distinct days observed over a ${stats.coverageDays}-day window.`,
    );
  }

  let idx = LEVELS.indexOf(level);

  if (
    stats.newestObservedAt !== null &&
    asOf.getTime() - Date.parse(stats.newestObservedAt) > STALENESS_DAYS * 86_400_000
  ) {
    idx = Math.max(0, idx - 1);
    reasons.push(
      `The most recent observation is more than ${STALENESS_DAYS} days old, so confidence is reduced.`,
    );
  }

  const medianAll = stats.medianAllCents;
  if (medianAll !== null && medianAll > 0 && daily.length > 0) {
    const sorted = daily.map((p) => p.medianPriceCents).sort((a, b) => a - b);
    const q1 = quartile(sorted, true);
    const q3 = quartile(sorted, false);
    if (q1 !== null && q3 !== null && (q3 - q1) / medianAll > DISPERSION_THRESHOLD) {
      idx = Math.max(0, idx - 1);
      reasons.push(`Observed prices are widely dispersed, so confidence is reduced.`);
    }
  }

  return { level: LEVELS[idx] ?? "INSUFFICIENT", reasons };
}
