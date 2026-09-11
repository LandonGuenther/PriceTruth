import type { HistoricalStats } from "@pricetruth/shared";
import { collapseToDailySeries, dayDiff, median, utcDay } from "./daily.js";
import type { DailyPoint, ScoringObservation } from "./types.js";

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Daily points whose day is within the last `days` days ending on asOf's UTC day (inclusive). */
export function dailyPointsInWindow(daily: DailyPoint[], asOf: Date, days: number): DailyPoint[] {
  const asOfDay = utcDay(asOf);
  return daily.filter((p) => {
    const diff = dayDiff(p.day, asOfDay);
    return diff >= 0 && diff <= days - 1;
  });
}

/**
 * Compute HistoricalStats per docs/SCORING.md.
 * `current`/`reference` are taken from the newest observation.
 */
export function computeStats(observations: ScoringObservation[], asOf: Date): HistoricalStats {
  const daily = collapseToDailySeries(observations);
  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  const observationCount = observations.length;
  const uniqueDays = daily.length;
  const first = daily[0];
  const last = daily[daily.length - 1];
  const coverageDays = first && last ? dayDiff(first.day, last.day) + 1 : 0;

  const newest = sorted[sorted.length - 1];
  const oldest = sorted[0];
  const current = newest?.priceCents;
  const reference = newest?.referencePriceCents ?? null;

  const medianInWindow = (days: number): number | null => {
    const pts = dailyPointsInWindow(daily, asOf, days);
    if (pts.length < 3) return null;
    return median(pts.map((p) => p.medianPriceCents));
  };
  const lowInWindow = (days: number): number | null => {
    const pts = dailyPointsInWindow(daily, asOf, days);
    if (pts.length === 0) return null;
    return Math.min(...pts.map((p) => p.medianPriceCents));
  };

  const dailyPrices = daily.map((p) => p.medianPriceCents);

  return {
    observationCount,
    uniqueDays,
    coverageDays,
    newestObservedAt: newest?.observedAt ?? null,
    oldestObservedAt: oldest?.observedAt ?? null,
    median30Cents: medianInWindow(30),
    median90Cents: medianInWindow(90),
    median180Cents: medianInWindow(180),
    medianAllCents: median(dailyPrices),
    low90Cents: lowInWindow(90),
    low180Cents: lowInWindow(180),
    recordedLowCents: uniqueDays > 0 ? Math.min(...dailyPrices) : null,
    recordedHighCents: uniqueDays > 0 ? Math.max(...dailyPrices) : null,
    pricePercentile:
      current === undefined || uniqueDays === 0
        ? null
        : round1((100 * dailyPrices.filter((p) => p < current).length) / uniqueDays),
    shareAtOrBelowCurrent:
      current === undefined || uniqueDays === 0
        ? null
        : round1((100 * dailyPrices.filter((p) => p <= current).length) / uniqueDays),
    referencePricePercentile:
      reference === null || uniqueDays === 0
        ? null
        : round1((100 * dailyPrices.filter((p) => p < reference).length) / uniqueDays),
    shareNearReference:
      reference === null || uniqueDays === 0
        ? null
        : round1((100 * dailyPrices.filter((p) => p >= 0.98 * reference).length) / uniqueDays),
  };
}
