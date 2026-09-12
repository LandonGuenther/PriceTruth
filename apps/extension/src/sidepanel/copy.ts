import { PRODUCT_NAME, RETAILERS } from "@pricetruth/shared";

const retailerNames = Object.values(RETAILERS)
  .map((r) => r.displayName)
  .join(" or ");

export const COPY = {
  tagline: "Know what it really costs.",
  today: "Price",
  storeSays: "Listed as",
  historySays: "Usually",
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
  notEnoughData: "Not enough data",
  discountIntegrity: "Discount Integrity",
  dealScore: "Deal Score",
  why: "Why this verdict",
  confidence: "Confidence",
  confidenceLabel: (level: string) => level.charAt(0) + level.slice(1).toLowerCase(),
  observationsAcross: (count: number, days: number) => `${count} observations across ${days} days`,
  idle: `Open a supported product page on ${retailerNames}.`,
  unsupported: "This page isn't a supported product page.",
  noPrice: "We couldn't read a price on this page, so nothing was recorded.",
  ambiguous:
    "We found this product but could not confidently determine its current price. Nothing was recorded.",
  loading: "Reading price…",
  retry: "Retry",
  learningTitle: "Need more history for scores",
  learningBody: `${PRODUCT_NAME} has too few price checks to score this listing yet. The price above is live; Deal Score and Discount Integrity unlock after more history.`,
  learningObserved: (count: number) =>
    count === 1 ? "1 observation so far" : `${count} observations so far`,
  learningFirstSeen: (when: string) => `First observed ${when}`,
  historyHeading: "Price history",
  historyChartLabel: "Price history chart",
  historyTableSummary: "View price history as a table",
  historyDay: "Day",
  historyMedian: "Median price",
  chartWindowGroup: "History window",
  chartWindows: {
    d30: "30D",
    d90: "90D",
    d180: "180D",
    all: "ALL",
  },
  detailsSummary: "History and details",
  feedbackPrompt: "Is this price correct?",
  feedbackLooksRight: "Looks right",
  feedbackReport: "Report issue",
  feedbackThanks: "Thanks. Your note stays on this device.",
  feedbackReported: "Issue noted locally. Nothing was sent.",
  diagnostics: "Diagnostics",
  diagnosticsHide: "Hide diagnostics",
  diagnosticsRetailer: "Retailer",
  diagnosticsExternalId: "External ID",
  diagnosticsGeneration: "Generation",
  diagnosticsApiBase: "API base",
  diagnosticsWarnings: "Warnings",
  diagnosticsStatus: "Tab status",
  diagnosticsAdapter: "Adapter version",
  diagnosticsNone: "none",
  statusIdle: "Waiting for a product page",
  statusUnsupported: "Page is not supported",
  statusAmbiguous: "Price is ambiguous; nothing recorded",
  statusLoading: "Loading price analysis",
  statusReady: "Price analysis ready",
  statusReadyInsufficient: "Price shown; scores waiting on more history",
  statusError: "Something went wrong",
  /** One plain answer. No marketing voice. */
  verdict: {
    watching: {
      title: "Collecting history",
      body: "Too early to rate this listing. Check back after a few more price reads.",
    },
    softSale: {
      title: "Discount looks overstated",
      body: "The store's sale claim is bigger than recent prices support.",
    },
    goodDeal: {
      title: "Better than usual",
      body: "Today's price sits meaningfully below the recent typical.",
    },
    notGreat: {
      title: "Higher than usual",
      body: "Recent history says you can often find this for less.",
    },
    typical: {
      title: "About average",
      body: "Today's price is close to what this listing usually sells for.",
    },
  },
  compareHeading: "Store claim vs history",
  statusChip: {
    watching: "WATCHING",
    softSale: "WEAK CLAIM",
    goodDeal: "SOLID",
    notGreat: "HIGH",
    typical: "TYPICAL",
  },
} as const;

export type VerdictKind = keyof typeof COPY.verdict;
