import type { RetailerId, RetailerObservation } from "@pricetruth/shared";

export type ExtractionFailureReason =
  "not_product_page" | "no_identifier" | "no_price" | "ambiguous_price" | "invalid";

export type ExtractionResult =
  | { ok: true; observation: RetailerObservation; warnings: string[] }
  | {
      ok: false;
      reason: ExtractionFailureReason;
      warnings: string[];
    };

export interface RetailerAdapter {
  retailer: RetailerId;
  /** True if the URL looks like a product page for this retailer. */
  matchesUrl(url: URL): boolean;
  extractExternalId(url: URL, doc: Document): string | null;
  extract(doc: Document, url: URL, now: Date): ExtractionResult;
}
