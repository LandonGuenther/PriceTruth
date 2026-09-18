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
  /** Additive (Devin backend): ObservationStatus after ingest. */
  status?: string;
  /** Additive: Best Buy enrichment outcome. */
  enrichment?: { bestbuyApi: string };
  /** Additive: API wire version echoed on success bodies. */
  apiVersion?: number;
}

/** Response header advertising the API's wire/schema major version. */
export const API_VERSION_HEADER = "x-pricetruth-api-version";

/**
 * Highest API schema major this extension client understands.
 * A response advertising a greater major is treated as unsupported.
 */
export const CLIENT_API_SCHEMA_MAJOR = 1;

/** Response header advertising the observation wire schema major. */
export const OBSERVATION_SCHEMA_VERSION_HEADER = "x-pricetruth-observation-schema-version";

/** Echoed/correlation request id (client may supply; server always returns one). */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Highest observation schema major this client understands.
 * A response advertising a greater major is treated as unsupported.
 */
export const CLIENT_OBSERVATION_SCHEMA_MAJOR = 1;

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
  constructor(message = "Malformed API response") {
    super(message);
    this.name = "ApiMalformedError";
  }
}

export class ApiUnsupportedVersionError extends Error {
  constructor(
    public readonly serverMajor: number,
    public readonly clientMajor: number,
  ) {
    super(`API schema major ${serverMajor} is newer than this client (supports ${clientMajor})`);
    this.name = "ApiUnsupportedVersionError";
  }
}

export class ApiRateLimitedError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    message = "Rate limited by API",
  ) {
    super(message);
    this.name = "ApiRateLimitedError";
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== "string") throw new ApiMalformedError(`expected string at ${path}`);
  return v;
}

function requireBoolean(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new ApiMalformedError(`expected boolean at ${path}`);
  return v;
}

function requireNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ApiMalformedError(`expected number at ${path}`);
  }
  return v;
}

function optionalNumber(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null;
  return requireNumber(v, path);
}

function requireStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new ApiMalformedError(`expected string[] at ${path}`);
  }
  return v as string[];
}

/** Parse `1`, `1.2`, `2.0.0` etc. Returns null when absent/unparseable. */
export function parseApiVersionMajor(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const majorPart = trimmed.split(".", 1)[0] ?? "";
  if (!/^\d+$/.test(majorPart)) return null;
  return Number(majorPart);
}

export function assertApiVersionCompatible(
  header: string | null,
  clientMajor: number = CLIENT_API_SCHEMA_MAJOR,
): void {
  const serverMajor = parseApiVersionMajor(header);
  if (serverMajor === null) return; // header optional
  if (serverMajor > clientMajor) {
    throw new ApiUnsupportedVersionError(serverMajor, clientMajor);
  }
}

export function parseIngestResponse(body: unknown): IngestResponse {
  if (!isRecord(body)) throw new ApiMalformedError("ingest response is not an object");
  const result: IngestResponse = {
    accepted: requireBoolean(body.accepted, "accepted"),
    duplicate: requireBoolean(body.duplicate, "duplicate"),
    listingId: requireString(body.listingId, "listingId"),
    observationId: requireString(body.observationId, "observationId"),
  };
  // Additive fields: validate type when present; never require them (older servers).
  if (body.status !== undefined) {
    result.status = requireString(body.status, "status");
  }
  if (body.apiVersion !== undefined) {
    result.apiVersion = requireNumber(body.apiVersion, "apiVersion");
  }
  if (body.enrichment !== undefined) {
    if (!isRecord(body.enrichment)) {
      throw new ApiMalformedError("expected object at enrichment");
    }
    result.enrichment = {
      bestbuyApi: requireString(body.enrichment.bestbuyApi, "enrichment.bestbuyApi"),
    };
  }
  return result;
}

function parseScoreResult(
  v: unknown,
  path: string,
): {
  score: number | null;
  label: string;
  reasons: string[];
} {
  if (!isRecord(v)) throw new ApiMalformedError(`expected object at ${path}`);
  return {
    score: optionalNumber(v.score, `${path}.score`),
    label: requireString(v.label, `${path}.label`),
    reasons: requireStringArray(v.reasons, `${path}.reasons`),
  };
}

export function parseAnalysisResponse(body: unknown): AnalysisResponse {
  if (!isRecord(body)) throw new ApiMalformedError("analysis response is not an object");
  if (!isRecord(body.stats)) throw new ApiMalformedError("expected object at stats");
  if (!isRecord(body.confidence)) throw new ApiMalformedError("expected object at confidence");
  if (!isRecord(body.typical)) throw new ApiMalformedError("expected object at typical");
  if (!isRecord(body.discountIntegrity)) {
    throw new ApiMalformedError("expected object at discountIntegrity");
  }

  const confidenceLevel = requireString(body.confidence.level, "confidence.level");
  const typicalWindow = body.typical.window;
  if (
    typicalWindow !== null &&
    typicalWindow !== undefined &&
    typicalWindow !== "90d" &&
    typicalWindow !== "180d" &&
    typicalWindow !== "all"
  ) {
    throw new ApiMalformedError("expected typical.window to be 90d|180d|all|null");
  }

  const diBase = parseScoreResult(body.discountIntegrity, "discountIntegrity");
  const dealScore = parseScoreResult(body.dealScore, "dealScore");

  // Lenient: keep unknown top-level / nested fields by spreading after validation.
  const parsed: AnalysisResponse = {
    ...(body as unknown as AnalysisResponse),
    retailer: requireString(body.retailer, "retailer") as RetailerId,
    externalId: requireString(body.externalId, "externalId"),
    title: requireString(body.title, "title"),
    url: requireString(body.url, "url"),
    currency: requireString(body.currency, "currency"),
    currentPriceCents: requireNumber(body.currentPriceCents, "currentPriceCents"),
    referencePriceCents: optionalNumber(body.referencePriceCents, "referencePriceCents"),
    effectiveAt: requireString(body.effectiveAt, "effectiveAt"),
    typical: {
      cents: optionalNumber(body.typical.cents, "typical.cents"),
      window: (typicalWindow ?? null) as AnalysisResponse["typical"]["window"],
    },
    stats: {
      ...(body.stats as unknown as AnalysisResponse["stats"]),
      observationCount: requireNumber(body.stats.observationCount, "stats.observationCount"),
      uniqueDays: requireNumber(body.stats.uniqueDays, "stats.uniqueDays"),
      coverageDays: requireNumber(body.stats.coverageDays, "stats.coverageDays"),
      newestObservedAt:
        body.stats.newestObservedAt === null || body.stats.newestObservedAt === undefined
          ? null
          : requireString(body.stats.newestObservedAt, "stats.newestObservedAt"),
      oldestObservedAt:
        body.stats.oldestObservedAt === null || body.stats.oldestObservedAt === undefined
          ? null
          : requireString(body.stats.oldestObservedAt, "stats.oldestObservedAt"),
      median30Cents: optionalNumber(body.stats.median30Cents, "stats.median30Cents"),
      median90Cents: optionalNumber(body.stats.median90Cents, "stats.median90Cents"),
      median180Cents: optionalNumber(body.stats.median180Cents, "stats.median180Cents"),
      medianAllCents: optionalNumber(body.stats.medianAllCents, "stats.medianAllCents"),
      low90Cents: optionalNumber(body.stats.low90Cents, "stats.low90Cents"),
      low180Cents: optionalNumber(body.stats.low180Cents, "stats.low180Cents"),
      recordedLowCents: optionalNumber(body.stats.recordedLowCents, "stats.recordedLowCents"),
      recordedHighCents: optionalNumber(body.stats.recordedHighCents, "stats.recordedHighCents"),
      pricePercentile: optionalNumber(body.stats.pricePercentile, "stats.pricePercentile"),
      shareAtOrBelowCurrent: optionalNumber(
        body.stats.shareAtOrBelowCurrent,
        "stats.shareAtOrBelowCurrent",
      ),
      referencePricePercentile: optionalNumber(
        body.stats.referencePricePercentile,
        "stats.referencePricePercentile",
      ),
      shareNearReference: optionalNumber(body.stats.shareNearReference, "stats.shareNearReference"),
    },
    confidence: {
      level: confidenceLevel as AnalysisResponse["confidence"]["level"],
      reasons: requireStringArray(body.confidence.reasons, "confidence.reasons"),
    },
    discountIntegrity: {
      ...diBase,
      advertisedDiscountPct: optionalNumber(
        body.discountIntegrity.advertisedDiscountPct,
        "discountIntegrity.advertisedDiscountPct",
      ),
      actualDiscountVsTypicalPct: optionalNumber(
        body.discountIntegrity.actualDiscountVsTypicalPct,
        "discountIntegrity.actualDiscountVsTypicalPct",
      ),
    },
    dealScore,
    computedAt: requireString(body.computedAt, "computedAt"),
  };

  // evidence is required on the shared type but older servers may omit it; synthesize empty.
  if (!isRecord(body.evidence)) {
    parsed.evidence = {
      eligibleCount: parsed.stats.observationCount,
      excluded: { synthetic: 0, quarantined: 0, excluded: 0, priceType: 0 },
    };
  } else {
    const ex = isRecord(body.evidence.excluded) ? body.evidence.excluded : {};
    parsed.evidence = {
      eligibleCount: requireNumber(body.evidence.eligibleCount, "evidence.eligibleCount"),
      excluded: {
        synthetic: requireNumber(ex.synthetic ?? 0, "evidence.excluded.synthetic"),
        quarantined: requireNumber(ex.quarantined ?? 0, "evidence.excluded.quarantined"),
        excluded: requireNumber(ex.excluded ?? 0, "evidence.excluded.excluded"),
        priceType: requireNumber(ex.priceType ?? 0, "evidence.excluded.priceType"),
      },
    };
  }

  return parsed;
}

export function parseHistoryResponse(body: unknown): HistoryResponse {
  if (!isRecord(body)) throw new ApiMalformedError("history response is not an object");
  if (!Array.isArray(body.points)) throw new ApiMalformedError("expected array at points");
  if (!Array.isArray(body.daily)) throw new ApiMalformedError("expected array at daily");

  const points: HistoryResponse["points"] = body.points.map((p, i) => {
    if (!isRecord(p)) throw new ApiMalformedError(`expected object at points[${i}]`);
    return {
      ...(p as HistoryResponse["points"][number]),
      effectiveAt: requireString(p.effectiveAt, `points[${i}].effectiveAt`),
      priceCents: requireNumber(p.priceCents, `points[${i}].priceCents`),
      referencePriceCents: optionalNumber(
        p.referencePriceCents,
        `points[${i}].referencePriceCents`,
      ),
      source: requireString(p.source, `points[${i}].source`),
    };
  });

  const daily: HistoryResponse["daily"] = body.daily.map((d, i) => {
    if (!isRecord(d)) throw new ApiMalformedError(`expected object at daily[${i}]`);
    return {
      ...(d as HistoryResponse["daily"][number]),
      day: requireString(d.day, `daily[${i}].day`),
      medianPriceCents: requireNumber(d.medianPriceCents, `daily[${i}].medianPriceCents`),
    };
  });

  return {
    ...(body as unknown as HistoryResponse),
    retailer: requireString(body.retailer, "retailer") as RetailerId,
    externalId: requireString(body.externalId, "externalId"),
    days: requireNumber(body.days, "days"),
    points,
    daily,
  };
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
    parse: (body: unknown) => T,
    init: RequestInit = {},
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        credentials: "omit",
        ...init,
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          [CLIENT_VERSION_HEADER]: this.clientVersion,
          [REQUEST_ID_HEADER]: requestId,
          ...(init.headers ?? {}),
        },
      });
      assertApiVersionCompatible(res.headers.get(API_VERSION_HEADER));
      assertApiVersionCompatible(
        res.headers.get(OBSERVATION_SCHEMA_VERSION_HEADER),
        CLIENT_OBSERVATION_SCHEMA_MAJOR,
      );
      if (!res.ok) {
        if (res.status === 429) {
          let retryAfterSeconds = 0;
          try {
            const errBody: unknown = await res.json();
            if (
              isRecord(errBody) &&
              typeof errBody.retryAfterSeconds === "number" &&
              Number.isFinite(errBody.retryAfterSeconds)
            ) {
              retryAfterSeconds = Math.max(0, Math.ceil(errBody.retryAfterSeconds));
            }
          } catch {
            // body optional; still surface rate limit
          }
          throw new ApiRateLimitedError(
            retryAfterSeconds,
            `API rate limited for ${path} (retry after ${retryAfterSeconds}s)`,
          );
        }
        throw new ApiError(res.status, `API ${res.status} for ${path}`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ApiMalformedError(`non-JSON body for ${path}`);
      }
      return parse(body);
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
    return this.request("/v1/observations", parseIngestResponse, {
      method: "POST",
      body: JSON.stringify(observation),
    });
  }

  getAnalysis(retailer: RetailerId, externalId: string): Promise<AnalysisResponse> {
    return this.request(
      `/v1/listings/${encodeURIComponent(retailer)}/${encodeURIComponent(externalId)}/analysis`,
      parseAnalysisResponse,
    );
  }

  getHistory(retailer: RetailerId, externalId: string, days = 180): Promise<HistoryResponse> {
    return this.request(
      `/v1/listings/${encodeURIComponent(retailer)}/${encodeURIComponent(externalId)}/history?days=${days}`,
      parseHistoryResponse,
    );
  }
}
