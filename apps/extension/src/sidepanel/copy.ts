import { PRODUCT_NAME, RETAILERS } from "@pricetruth/shared";

const retailerNames = Object.values(RETAILERS)
  .map((r) => r.displayName)
  .join(" or ");

export const COPY = {
  today: "TODAY",
  storeSays: "STORE SAYS",
  historySays: "HISTORY SAYS",
  noAdvertisedDiscount: "No advertised discount",
  storeReference: (pct: number, ref: string) => `${pct}% off store reference of ${ref}`,
  typicalRecentPrice: "Typical recent price",
  belowTypical: (pct: number) => `~${pct}% below typical recent price`,
  aboveTypical: (pct: number) => `~${pct}% above typical recent price`,
  typical30: "30-day typical",
  typical90: "90-day typical",
  typical180: "180-day typical",
  low90: "90-day low",
  recordedLow: `${PRODUCT_NAME} recorded low`,
  discountIntegrity: "DISCOUNT INTEGRITY",
  dealScore: "DEAL SCORE",
  why: "WHY?",
  confidence: "CONFIDENCE",
  confidenceLabel: (level: string) => level.charAt(0) + level.slice(1).toLowerCase(),
  observationsAcross: (count: number, days: number) => `${count} observations across ${days} days`,
  idle: `Open a supported product page on ${retailerNames}.`,
  unsupported: "This page isn't a supported product page.",
  noPrice: "We couldn't read a price on this page, so nothing was recorded.",
  ambiguous:
    "We found this product but could not confidently determine its current price. Nothing was recorded.",
  loading: "Reading price evidence…",
  retry: "Retry",
  insufficientNotice: (count: number) =>
    `${PRODUCT_NAME} has only ${count} observation(s) for this listing. Scores appear once there is enough history.`,
  insufficientEvidence: "Insufficient evidence",
  limitedHistory: "Limited history",
} as const;
