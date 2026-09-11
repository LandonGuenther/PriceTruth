import type {
  AnalysisResponse,
  HistoryResponse,
  RetailerId,
  RetailerObservation,
} from "@pricetruth/shared";

export type ExtractionFailureReason =
  | "not_product_page"
  | "no_identifier"
  | "no_price"
  | "ambiguous_price"
  | "invalid";

export type ContentToBackground =
  | { type: "pt/observation"; observation: RetailerObservation; warnings?: string[] }
  | {
      type: "pt/extraction-failed";
      retailer: RetailerId;
      reason: ExtractionFailureReason;
      url: string;
      warnings: string[];
    };

/** Sent by the side panel to re-run the last observation for a tab. */
export type PanelToBackground =
  | { type: "pt/retry"; tabId: number }
  | { type: "pt/set-diagnostics"; enabled: boolean };

/** Sent background → content to check the content script is alive on this tab. */
export type BackgroundToContent = { type: "pt/ping" };
export type ContentPong = { type: "pt/pong" };

export type RuntimeMessage = ContentToBackground | PanelToBackground | BackgroundToContent;

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
      warnings?: string[];
    }
  | {
      status: "ambiguous";
      retailer: RetailerId;
      url: string;
      warnings: string[];
      message: string;
    }
  | {
      status: "loading";
      observation: RetailerObservation;
      phase: "submitting" | "analyzing";
      generation: number;
      warnings?: string[];
    }
  | {
      status: "ready";
      observation: RetailerObservation;
      analysis: AnalysisResponse;
      history: HistoryResponse;
      ingest: { accepted: boolean; duplicate: boolean };
      updatedAt: string;
      generation: number;
      warnings?: string[];
    }
  | {
      status: "error";
      observation?: RetailerObservation;
      message: string;
      updatedAt: string;
      kind: "network" | "api" | "timeout" | "malformed" | "unsupported_version" | "unknown";
      generation?: number;
    };

export const tabStateKey = (tabId: number): string => `tab:${tabId}`;

/** Session key for the developer diagnostics toggle (global, not per-tab). */
export const DIAGNOSTICS_KEY = "pt:diagnostics";
