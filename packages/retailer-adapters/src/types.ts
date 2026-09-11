import type { RetailerId, RetailerObservation } from "@pricetruth/shared";

/** Confidence assigned by a retailer adapter for a single extraction field. */
export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW" | "AMBIGUOUS";

/**
 * Per-attempt extraction diagnostics. Kept on the adapter result (not the
 * shared RetailerObservation schema) so content scripts can forward it as
 * ExtractionMeta without widening the ingest payload.
 */
export interface ExtractionMeta {
  adapterVersion: string;
  identityMethod?: string;
  priceMethod?: string;
  referenceMethod?: string;
  identityConfidence?: ExtractionConfidence;
  priceConfidence?: ExtractionConfidence;
  referenceConfidence?: ExtractionConfidence;
  warnings: string[];
}

export type ExtractionFailureReason =
  "not_product_page" | "no_identifier" | "no_price" | "invalid" | "ambiguous_price";

export type ExtractionResult =
  | {
      ok: true;
      observation: RetailerObservation;
      warnings: string[];
      meta: ExtractionMeta;
    }
  | {
      ok: false;
      reason: ExtractionFailureReason;
      warnings: string[];
      meta?: ExtractionMeta;
    };

export interface RetailerAdapter {
  retailer: RetailerId;
  /** True if the URL looks like a product page for this retailer. */
  matchesUrl(url: URL): boolean;
  extractExternalId(url: URL, doc: Document): string | null;
  extract(doc: Document, url: URL, now: Date): ExtractionResult;
}
