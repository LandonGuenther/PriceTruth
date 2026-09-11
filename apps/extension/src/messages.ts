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

export type RuntimeMessage = ContentToBackground | PanelToBackground;

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
