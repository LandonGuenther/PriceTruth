import type { HistoricalStats, TypicalWindow } from "@pricetruth/shared";

export function computeTypical(stats: HistoricalStats): {
  cents: number | null;
  window: TypicalWindow;
} {
  if (stats.median90Cents !== null) return { cents: stats.median90Cents, window: "90d" };
  if (stats.median180Cents !== null) return { cents: stats.median180Cents, window: "180d" };
  if (stats.medianAllCents !== null) return { cents: stats.medianAllCents, window: "all" };
  return { cents: null, window: null };
}
