import type {
  AnalysisResponse,
  HistoryResponse,
  RetailerId,
  RetailerObservation,
} from "@pricetruth/shared";

export type ExtractionFailureReason = "not_product_page" | "no_identifier" | "no_price" | "invalid";

export type ContentToBackground =
  | { type: "pt/observation"; observation: RetailerObservation }
  | {
      type: "pt/extraction-failed";
      retailer: RetailerId;
      reason: ExtractionFailureReason;
      url: string;
      warnings: string[];
    };

/** Sent by the side panel to re-run the last observation for a tab. */
export type PanelToBackground = { type: "pt/retry"; tabId: number };

/** Sent background → content to check the content script is alive on this tab. */
export type BackgroundToContent = { type: "pt/ping" };
export type ContentPong = { type: "pt/pong" };

export type RuntimeMessage = ContentToBackground | PanelToBackground | BackgroundToContent;

export type TabState =
  | { status: "idle" }
  | { status: "unsupported"; retailer?: RetailerId; reason?: string }
  | { status: "loading"; observation: RetailerObservation }
  | {
      status: "ready";
      observation: RetailerObservation;
      analysis: AnalysisResponse;
      history: HistoryResponse;
      ingest: { accepted: boolean; duplicate: boolean };
      updatedAt: string;
    }
  | {
      status: "error";
      observation?: RetailerObservation;
      message: string;
      updatedAt: string;
    };

export const tabStateKey = (tabId: number): string => `tab:${tabId}`;
