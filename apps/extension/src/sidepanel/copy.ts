import { PRODUCT_NAME, RETAILERS } from "@pricetruth/shared";

const retailerNames = Object.values(RETAILERS)
  .map((r) => r.displayName)
  .join(" or ");

export const COPY = {
  tagline: "Know what it really costs.",
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
  noPrice: "We couldn't confidently read a purchase price on this page, so nothing was recorded.",
  loading: "Reading price evidence…",
  loadingSubmit: "Saving today's price…",
  loadingAnalyze: "Checking price history…",
  retry: "Retry",
  insufficientTitle: `${PRODUCT_NAME} is still learning this product`,
  insufficientBody: (count: number) =>
    count <= 0
      ? "We do not yet have enough price history to judge this discount reliably."
      : `We have ${count} observation(s) so far. We do not yet have enough price history to judge this discount reliably.`,
  insufficientNotice: (count: number) =>
    `${PRODUCT_NAME} has only ${count} observation(s) for this listing. Scores appear once there is enough history.`,
  insufficientEvidence: "Insufficient evidence",
  limitedHistory: "Limited history",
  ambiguousTitle: "Price looks ambiguous",
  ambiguousBody: `${PRODUCT_NAME} found this product but could not confidently determine its current price. Nothing was recorded.`,
  chartWindow: "Price history",
  window30: "30D",
  window90: "90D",
  window180: "180D",
  windowAll: "ALL",
  chartSummary: (n: number, low: string, high: string) =>
    `Price history with ${n} daily point(s). Range ${low} to ${high}.`,
  diagnostics: "Diagnostics",
  feedbackPrompt: "Is this price correct?",
  feedbackYes: "Looks right",
  feedbackNo: "Report issue",
  feedbackThanks: "Thanks - your note stays on this device unless you choose to share it.",
  liveStatus: "Status",
} as const;

/** Map known backend reason phrases / codes to stable consumer copy. Unknowns pass through. */
const REASON_MAP: Array<{ match: RegExp; copy: string }> = [
  {
    match: /reference price not supported|rarely observed|above \d+% of observed/i,
    copy: "The store's reference price is rarely (or never) seen in our observed history.",
  },
  {
    match: /below typical|below the typical/i,
    copy: "Today's price is below this listing's typical recent price.",
  },
  {
    match: /above typical|above the typical/i,
    copy: "Today's price is above this listing's typical recent price.",
  },
  {
    match: /recorded low|lowest .* recorded/i,
    copy: "Today's price is near the lowest price PriceTruth has recorded for this listing.",
  },
  {
    match: /not enough history|limited history|insufficient/i,
    copy: "There is not enough observed history yet to score this listing confidently.",
  },
  {
    match: /recent (price )?increase|rose recently/i,
    copy: "The reference looks like a possible recent price increase rather than a long-standing list price.",
  },
];

export function humanizeReason(raw: string): string {
  for (const entry of REASON_MAP) {
    if (entry.match.test(raw)) return entry.copy;
  }
  // Strip anything that looks like a stack fragment; keep the rest.
  const cleaned = raw.replace(/\s+at\s+\S+.*/g, "").trim();
  return cleaned.length > 0 ? cleaned : "Additional evidence is available in the scores above.";
}
