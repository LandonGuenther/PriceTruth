import type { DailyPoint, ScoringObservation } from "./types.js";

export function utcDay(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

/** Whole UTC days between two calendar days (b - a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Median of numbers: midpoint definition, averaged middle pair rounded to integer. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

/**
 * Collapse observations to one point per UTC calendar day: the median of that
 * day's prices. Returned sorted ascending by day.
 */
export function collapseToDailySeries(observations: ScoringObservation[]): DailyPoint[] {
  const byDay = new Map<string, number[]>();
  for (const obs of observations) {
    const day = utcDay(obs.effectiveAt);
    const list = byDay.get(day);
    if (list) list.push(obs.priceCents);
    else byDay.set(day, [obs.priceCents]);
  }
  const points: DailyPoint[] = [];
  for (const [day, prices] of byDay) {
    const m = median(prices);
    if (m !== null) points.push({ day, medianPriceCents: m });
  }
  return points.sort((a, b) => a.day.localeCompare(b.day));
}
