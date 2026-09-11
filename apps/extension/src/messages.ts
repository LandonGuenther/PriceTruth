import type {
  AnalysisResponse,
  HistoryResponse,
  RetailerId,
  RetailerObservation,
} from "@pricetruth/shared";

export type ExtractionFailureReason =
  "not_product_page" | "no_identifier" | "no_price" | "invalid" | "ambiguous_price";

export type ContentToBackground =
  | { type: "pt/observation"; observation: RetailerObservation; extraction?: ExtractionMeta }
  | {
      type: "pt/extraction-failed";
      retailer: RetailerId;
      reason: ExtractionFailureReason;
      url: string;
      warnings: string[];
      extraction?: ExtractionMeta;
    };

/** Sent by the side panel to re-run the last observation for a tab. */
export type PanelToBackground =
  { type: "pt/retry"; tabId: number } | { type: "pt/set-diagnostics"; enabled: boolean };

/** Sent background → content to check the content script is alive on this tab. */
export type BackgroundToContent = { type: "pt/ping" };
export type ContentPong = { type: "pt/pong" };

export type RuntimeMessage = ContentToBackground | PanelToBackground | BackgroundToContent;

/** Confidence assigned by a retailer adapter for a single extraction attempt. */
export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW" | "AMBIGUOUS";

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

/**
 * Formal side-panel state machine. Every status is terminal until the next
 * content/background event; there is never a silent endless spinner.
 *
 * Identity changes must move through `loading` (or `unsupported`) and must not
 * leave a previous product's `ready` analysis on screen.
 */
export type TabState =
  | { status: "idle" }
  | {
      status: "unsupported";
      retailer?: RetailerId;
      reason?: ExtractionFailureReason | string;
      extraction?: ExtractionMeta;
    }
  | {
      status: "loading";
      observation: RetailerObservation;
      phase: "submitting" | "analyzing";
      generation: number;
      extraction?: ExtractionMeta;
    }
  | {
      status: "ready";
      observation: RetailerObservation;
      analysis: AnalysisResponse;
      history: HistoryResponse;
      ingest: { accepted: boolean; duplicate: boolean };
      updatedAt: string;
      generation: number;
      extraction?: ExtractionMeta;
    }
  | {
      status: "error";
      observation?: RetailerObservation;
      message: string;
      updatedAt: string;
      kind: "network" | "api" | "timeout" | "unknown";
      generation?: number;
      extraction?: ExtractionMeta;
    }
  | {
      status: "ambiguous";
      observation?: Partial<RetailerObservation> &
        Pick<RetailerObservation, "retailer" | "url" | "title">;
      message: string;
      extraction?: ExtractionMeta;
    };

export const tabStateKey = (tabId: number): string => `tab:${tabId}`;

/** Session key for the developer diagnostics toggle (global, not per-tab). */
export const DIAGNOSTICS_KEY = "pt:diagnostics";
