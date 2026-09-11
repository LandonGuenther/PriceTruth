import type {
  AnalysisResponse,
  HistoryResponse,
  RetailerId,
  RetailerObservation,
} from "@pricetruth/shared";
import { CLIENT_VERSION_HEADER } from "@pricetruth/shared";

export interface IngestResponse {
  accepted: boolean;
  duplicate: boolean;
  listingId: string;
  observationId: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiTimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "ApiTimeoutError";
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    // Wrap rather than store `fetch` directly: calling a stored bare `fetch`
    // throws "Illegal invocation" in Chrome (non-global this).
    private readonly fetchImpl: FetchFn = (url, init) => fetch(url, init),
    private readonly clientVersion: string = "dev",
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        credentials: "omit",
        ...init,
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          [CLIENT_VERSION_HEADER]: this.clientVersion,
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        throw new ApiError(res.status, `API ${res.status} for ${path}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiTimeoutError();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  postObservation(observation: RetailerObservation): Promise<IngestResponse> {
    return this.request<IngestResponse>("/v1/observations", {
      method: "POST",
      body: JSON.stringify(observation),
    });
  }

  getAnalysis(retailer: RetailerId, externalId: string): Promise<AnalysisResponse> {
    return this.request<AnalysisResponse>(
      `/v1/listings/${encodeURIComponent(retailer)}/${encodeURIComponent(externalId)}/analysis`,
    );
  }

  getHistory(retailer: RetailerId, externalId: string, days = 180): Promise<HistoryResponse> {
    return this.request<HistoryResponse>(
      `/v1/listings/${encodeURIComponent(retailer)}/${encodeURIComponent(externalId)}/history?days=${days}`,
    );
  }
}
