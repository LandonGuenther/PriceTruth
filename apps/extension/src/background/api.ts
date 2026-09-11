import type {
  AnalysisResponse,
  HistoryResponse,
  RetailerId,
  RetailerObservation,
} from "@pricetruth/shared";
import { CLIENT_VERSION_HEADER } from "@pricetruth/shared";

/** Optional response header the API may send to advertise its schema/version. */
export const API_VERSION_HEADER = "x-pricetruth-api-version";

/** Client-understood analysis schema major version. Bump when parsing breaks. */
export const CLIENT_ANALYSIS_SCHEMA = 1;

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

export class ApiMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiMalformedError";
  }
}

export class ApiUnsupportedVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnsupportedVersionError";
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ApiMalformedError(`${ctx}: missing string field "${key}"`);
  }
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ApiMalformedError(`${ctx}: missing number field "${key}"`);
  }
  return v;
}

export function parseIngestResponse(data: unknown): IngestResponse {
  if (!isRecord(data)) throw new ApiMalformedError("ingest: response is not an object");
  const accepted = data.accepted;
  const duplicate = data.duplicate;
  if (typeof accepted !== "boolean" || typeof duplicate !== "boolean") {
    throw new ApiMalformedError("ingest: accepted/duplicate must be booleans");
  }
  return {
    accepted,
    duplicate,
    listingId: requireString(data, "listingId", "ingest"),
    observationId: requireString(data, "observationId", "ingest"),
  };
}

export function parseAnalysisResponse(data: unknown): AnalysisResponse {
  if (!isRecord(data)) throw new ApiMalformedError("analysis: response is not an object");
  // Forward-compatible: ignore unknown fields; require the fields the panel reads.
  requireString(data, "retailer", "analysis");
  requireString(data, "externalId", "analysis");
  requireString(data, "title", "analysis");
  requireString(data, "currency", "analysis");
  requireNumber(data, "currentPriceCents", "analysis");
  if (!isRecord(data.confidence) || typeof data.confidence.level !== "string") {
    throw new ApiMalformedError("analysis: confidence.level required");
  }
  if (!isRecord(data.stats)) throw new ApiMalformedError("analysis: stats required");
  if (!isRecord(data.discountIntegrity) || !isRecord(data.dealScore)) {
    throw new ApiMalformedError("analysis: discountIntegrity and dealScore required");
  }
  if (!isRecord(data.typical)) throw new ApiMalformedError("analysis: typical required");
  // Optional schemaVersion: if present and far ahead of us, fail safely.
  if (typeof data.schemaVersion === "number" && data.schemaVersion > CLIENT_ANALYSIS_SCHEMA) {
    throw new ApiUnsupportedVersionError(
      `analysis schemaVersion ${data.schemaVersion} is newer than client ${CLIENT_ANALYSIS_SCHEMA}`,
    );
  }
  return data as unknown as AnalysisResponse;
}

export function parseHistoryResponse(data: unknown): HistoryResponse {
  if (!isRecord(data)) throw new ApiMalformedError("history: response is not an object");
  requireString(data, "retailer", "history");
  requireString(data, "externalId", "history");
  if (!Array.isArray(data.daily)) throw new ApiMalformedError("history: daily array required");
  if (!Array.isArray(data.points)) throw new ApiMalformedError("history: points array required");
  return data as unknown as HistoryResponse;
}

function checkApiVersionHeader(res: Response): void {
  const raw = res.headers.get(API_VERSION_HEADER);
  if (!raw) return;
  const major = Number.parseInt(raw.split(".")[0] ?? "", 10);
  if (Number.isFinite(major) && major > CLIENT_ANALYSIS_SCHEMA) {
    throw new ApiUnsupportedVersionError(
      `API version ${raw} is newer than this extension understands`,
    );
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    // Wrap rather than store `fetch` directly: calling a stored bare `fetch`
    // throws "Illegal invocation" in Chrome (non-global this).
    private readonly fetchImpl: FetchFn = (url, init) => fetch(url, init),
    private readonly clientVersion: string = "dev",
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    parse: (data: unknown) => T,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        credentials: "omit",
        ...init,
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          [CLIENT_VERSION_HEADER]: this.clientVersion,
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        throw new ApiError(res.status, `API ${res.status} for ${path}`);
      }
      checkApiVersionHeader(res);
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new ApiMalformedError(`API returned non-JSON for ${path}`);
      }
      return parse(data);
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
    return this.request(
      "/v1/observations",
      { method: "POST", body: JSON.stringify(observation) },
      parseIngestResponse,
    );
  }

  getAnalysis(retailer: RetailerId, externalId: string): Promise<AnalysisResponse> {
    return this.request(
      `/v1/listings/${encodeURIComponent(retailer)}/${encodeURIComponent(externalId)}/analysis`,
      {},
      parseAnalysisResponse,
    );
  }

  getHistory(retailer: RetailerId, externalId: string, days = 180): Promise<HistoryResponse> {
    return this.request(
      `/v1/listings/${encodeURIComponent(retailer)}/${encodeURIComponent(externalId)}/history?days=${days}`,
      {},
      parseHistoryResponse,
    );
  }
}
