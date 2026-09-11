import type { RetailerId } from "./retailers.js";

export type ConfidenceLevel = "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH";

export interface HistoricalStats {
  observationCount: number;
  uniqueDays: number;
  coverageDays: number;
  newestObservedAt: string | null;
  oldestObservedAt: string | null;
  median30Cents: number | null;
  median90Cents: number | null;
  median180Cents: number | null;
  medianAllCents: number | null;
  low90Cents: number | null;
  low180Cents: number | null;
  recordedLowCents: number | null;
  recordedHighCents: number | null;
  pricePercentile: number | null;
  shareAtOrBelowCurrent: number | null;
  referencePricePercentile: number | null;
  shareNearReference: number | null;
}

export interface ScoreResult {
  score: number | null;
  label: string;
  reasons: string[];
}

export interface DiscountIntegrityResult extends ScoreResult {
  advertisedDiscountPct: number | null;
  actualDiscountVsTypicalPct: number | null;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  reasons: string[];
}

export type TypicalWindow = "90d" | "180d" | "all" | null;

export interface AnalysisResponse {
  retailer: RetailerId;
  externalId: string;
  title: string;
  url: string;
  currency: string;
  currentPriceCents: number;
  referencePriceCents: number | null;
  /** Effective observation time (server-authoritative per source trust class). */
  effectiveAt: string;
  typical: { cents: number | null; window: TypicalWindow };
  stats: HistoricalStats;
  confidence: ConfidenceResult;
  discountIntegrity: DiscountIntegrityResult;
  dealScore: ScoreResult;
  computedAt: string;
}

export interface HistoryResponse {
  retailer: RetailerId;
  externalId: string;
  days: number;
  points: Array<{
    effectiveAt: string;
    priceCents: number;
    referencePriceCents: number | null;
    source: string;
  }>;
  daily: Array<{ day: string; medianPriceCents: number }>;
}
