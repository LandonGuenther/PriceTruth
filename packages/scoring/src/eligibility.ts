/**
 * Single source of truth for which observations feed history, statistics and
 * scoring. DB queries must use exactly these constants.
 */
export const ELIGIBLE_STATUSES = ["ACCEPTED", "CORROBORATED"] as const;
export const ELIGIBLE_PRICE_TYPES = ["STANDARD", "SALE"] as const;

export type IneligibilityReason =
  "synthetic" | "status_quarantined" | "status_excluded" | "price_type";

export function ineligibilityReason(o: {
  status: string;
  synthetic: boolean;
  priceType: string;
}): IneligibilityReason | null {
  if (o.synthetic) return "synthetic";
  if (o.status === "QUARANTINED") return "status_quarantined";
  if (!(ELIGIBLE_STATUSES as readonly string[]).includes(o.status)) return "status_excluded";
  if (!(ELIGIBLE_PRICE_TYPES as readonly string[]).includes(o.priceType)) return "price_type";
  return null;
}

export function isEligibleForAnalysis(o: {
  status: string;
  synthetic: boolean;
  priceType: string;
}): boolean {
  return ineligibilityReason(o) === null;
}
