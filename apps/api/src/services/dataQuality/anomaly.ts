export const ANOMALY_ENGINE_VERSION = "1.0.0";

export interface AnomalyCandidate {
  priceCents: number;
  currency: string;
  trustClass: string;
  effectiveAt: Date;
}

export interface AnomalyContextRow {
  priceCents: number;
  currency: string;
  effectiveAt: Date;
}

export interface AnomalyVerdict {
  verdict: "ACCEPT" | "QUARANTINE";
  reasons: string[];
}

const DAY_MS = 86_400_000;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Stateless anomaly check for one candidate observation against the listing's
 * recent eligible history (context ordered newest-first, ≤20 rows, ≤30 days
 * before the candidate's effectiveAt). Only CLIENT_REPORTED candidates can be
 * quarantined — trusted sources are presumed sound. No absolute price ceilings.
 */
export function evaluateAnomaly(
  candidate: AnomalyCandidate,
  context: AnomalyContextRow[],
): AnomalyVerdict {
  if (candidate.trustClass !== "CLIENT_REPORTED") {
    return { verdict: "ACCEPT", reasons: [] };
  }
  const reasons: string[] = [];
  const prices = context.map((c) => c.priceCents);

  // currency_change
  if (context.length > 0 && context.some((c) => c.currency !== candidate.currency)) {
    reasons.push("currency_change");
  }

  if (context.length >= 3) {
    const med = median(prices);
    // large_move_vs_recent_median
    if (med > 0 && Math.abs(candidate.priceCents - med) / med > 0.6) {
      reasons.push("large_move_vs_recent_median");
    }
    // contradicts_recent_cluster
    if (context.length >= 5) {
      const spread = (Math.max(...prices) - Math.min(...prices)) / med;
      if (spread <= 0.05 && Math.abs(candidate.priceCents - med) / med > 0.25) {
        reasons.push("contradicts_recent_cluster");
      }
    }
  }

  // rapid_oscillation: within the last 24h (context rows + candidate), ≥3
  // direction changes each ≥20% of the previous price.
  const window = [candidate, ...context]
    .filter((r) => r.effectiveAt.getTime() >= candidate.effectiveAt.getTime() - DAY_MS)
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  let changes = 0;
  let direction = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!.priceCents;
    const cur = window[i]!.priceCents;
    if (prev <= 0 || cur === prev) continue;
    if (Math.abs(cur - prev) / prev < 0.2) continue;
    const dir = cur > prev ? 1 : -1;
    if (dir !== direction) {
      changes++;
      direction = dir;
    }
  }
  if (changes >= 3) reasons.push("rapid_oscillation");

  return { verdict: reasons.length > 0 ? "QUARANTINE" : "ACCEPT", reasons };
}
