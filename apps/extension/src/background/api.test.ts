import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  ApiError,
  ApiMalformedError,
  ApiRateLimitedError,
  ApiUnsupportedVersionError,
  API_VERSION_HEADER,
  CLIENT_API_SCHEMA_MAJOR,
  OBSERVATION_SCHEMA_VERSION_HEADER,
  REQUEST_ID_HEADER,
  parseAnalysisResponse,
  parseApiVersionMajor,
  parseHistoryResponse,
  parseIngestResponse,
} from "./api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ingestOk = {
  accepted: true,
  duplicate: false,
  listingId: "l1",
  observationId: "o1",
  futureField: "ignored",
};

const analysisOk = {
  retailer: "amazon",
  externalId: "B0TESTASIN",
  title: "Widget",
  url: "https://www.amazon.com/dp/B0TESTASIN",
  currency: "USD",
  currentPriceCents: 29900,
  referencePriceCents: 49900,
  effectiveAt: "2025-06-30T12:00:00.000Z",
  typical: { cents: 31900, window: "90d" },
  stats: {
    observationCount: 10,
    uniqueDays: 10,
    coverageDays: 10,
    newestObservedAt: "2025-06-30T12:00:00.000Z",
    oldestObservedAt: "2025-06-20T12:00:00.000Z",
    median30Cents: 31900,
    median90Cents: 31900,
    median180Cents: 31900,
    medianAllCents: 31900,
    low90Cents: 25900,
    low180Cents: 25900,
    recordedLowCents: 25900,
    recordedHighCents: 34900,
    pricePercentile: 0.5,
    shareAtOrBelowCurrent: 1,
    referencePricePercentile: 100,
    shareNearReference: 0,
  },
  confidence: { level: "HIGH", reasons: [] },
  discountIntegrity: {
    score: 9,
    label: "x",
    reasons: [],
    advertisedDiscountPct: 40,
    actualDiscountVsTypicalPct: 6,
  },
  dealScore: { score: 78, label: "y", reasons: [] },
  evidence: {
    eligibleCount: 10,
    excluded: { synthetic: 0, quarantined: 0, excluded: 0, priceType: 0 },
  },
  computedAt: "2025-06-30T12:00:00.000Z",
  unexpectedServerField: true,
};

const historyOk = {
  retailer: "amazon",
  externalId: "B0TESTASIN",
  days: 180,
  points: [],
  daily: [{ day: "2025-06-30", medianPriceCents: 29900, extra: 1 }],
};

describe("ApiClient", () => {
  it("calls fetch unbound-safe: default impl calls globalThis.fetch with global this", async () => {
    const spy = vi.fn(function (this: unknown) {
      // Regression guard: a stored bare `fetch` is called with a non-global
      // `this` and throws "Illegal invocation" in Chrome.
      expect(this === undefined || this === globalThis).toBe(true);
      return Promise.resolve(
        new Response(JSON.stringify(analysisOk), {
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x");
    const res = await client.getAnalysis("amazon", "B0TESTASIN");
    expect(res.externalId).toBe("B0TESTASIN");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws ApiError with status on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );
    const client = new ApiClient("http://x");
    await expect(client.getHistory("amazon", "B0TESTASIN")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
    await expect(client.getAnalysis("amazon", "B0TESTASIN")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiMalformedError on invalid JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not-json", { status: 200 }))),
    );
    const client = new ApiClient("http://x");
    await expect(client.postObservation(analysisOk as never)).rejects.toBeInstanceOf(
      ApiMalformedError,
    );
  });

  it("throws ApiUnsupportedVersionError when response major > client schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(ingestOk), {
            status: 200,
            headers: {
              "content-type": "application/json",
              [API_VERSION_HEADER]: String(CLIENT_API_SCHEMA_MAJOR + 1),
            },
          }),
        ),
      ),
    );
    const client = new ApiClient("http://x");
    await expect(
      client.postObservation({
        retailer: "amazon",
        externalId: "B0TESTASIN",
        url: "https://www.amazon.com/dp/B0TESTASIN",
        title: "W",
        priceCents: 1,
        currency: "USD",
        source: "extension:content-script",
        observedAt: "2025-06-30T12:00:00.000Z",
        schemaVersion: 1,
        priceType: "STANDARD",
      }),
    ).rejects.toBeInstanceOf(ApiUnsupportedVersionError);
  });

  it("accepts equal or older API version header and ignores unknown fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(ingestOk), {
            status: 200,
            headers: {
              "content-type": "application/json",
              [API_VERSION_HEADER]: "1.9.0",
            },
          }),
        ),
      ),
    );
    const client = new ApiClient("http://x");
    const res = await client.postObservation({
      retailer: "amazon",
      externalId: "B0TESTASIN",
      url: "https://www.amazon.com/dp/B0TESTASIN",
      title: "W",
      priceCents: 1,
      currency: "USD",
      source: "extension:content-script",
      observedAt: "2025-06-30T12:00:00.000Z",
      schemaVersion: 1,
      priceType: "STANDARD",
    });
    expect(res).toEqual({
      accepted: true,
      duplicate: false,
      listingId: "l1",
      observationId: "o1",
    });
  });

  it("does not retry failed requests", async () => {
    const spy = vi.fn(() => Promise.resolve(new Response("nope", { status: 503 })));
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x");
    await expect(client.getAnalysis("amazon", "B0TESTASIN")).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws ApiRateLimitedError with retryAfterSeconds on 429 (no retry)", async () => {
    const spy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "rate_limited", message: "slow down", retryAfterSeconds: 7 }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x");
    const err = await client.getAnalysis("amazon", "B0TESTASIN").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiRateLimitedError);
    expect(err).toMatchObject({ retryAfterSeconds: 7 });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("sends x-request-id and tolerates observation schema version header", async () => {
    const spy = vi.fn((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get(REQUEST_ID_HEADER)).toBeTruthy();
      return Promise.resolve(
        new Response(JSON.stringify(ingestOk), {
          status: 200,
          headers: {
            "content-type": "application/json",
            [API_VERSION_HEADER]: "1",
            [OBSERVATION_SCHEMA_VERSION_HEADER]: "1",
          },
        }),
      );
    });
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x");
    await client.postObservation({
      retailer: "amazon",
      externalId: "B0TESTASIN",
      url: "https://www.amazon.com/dp/B0TESTASIN",
      title: "W",
      priceCents: 1,
      currency: "USD",
      source: "extension:content-script",
      observedAt: "2025-06-30T12:00:00.000Z",
      schemaVersion: 1,
      priceType: "STANDARD",
    });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("response parsers", () => {
  it("parseApiVersionMajor reads the major component", () => {
    expect(parseApiVersionMajor(null)).toBeNull();
    expect(parseApiVersionMajor("")).toBeNull();
    expect(parseApiVersionMajor("2.3.4")).toBe(2);
    expect(parseApiVersionMajor("1")).toBe(1);
    expect(parseApiVersionMajor("nope")).toBeNull();
  });

  it("parseIngestResponse requires core fields and keeps typed additive fields", () => {
    expect(parseIngestResponse(ingestOk)).toEqual({
      accepted: true,
      duplicate: false,
      listingId: "l1",
      observationId: "o1",
    });
    expect(
      parseIngestResponse({
        ...ingestOk,
        status: "ACCEPTED",
        apiVersion: 1,
        enrichment: { bestbuyApi: "skipped" },
      }),
    ).toEqual({
      accepted: true,
      duplicate: false,
      listingId: "l1",
      observationId: "o1",
      status: "ACCEPTED",
      apiVersion: 1,
      enrichment: { bestbuyApi: "skipped" },
    });
    expect(() => parseIngestResponse({ accepted: true })).toThrow(ApiMalformedError);
    expect(() =>
      parseIngestResponse({ ...ingestOk, enrichment: { bestbuyApi: 1 } }),
    ).toThrow(ApiMalformedError);
  });

  it("parseAnalysisResponse tolerates unknown fields and missing evidence", () => {
    const parsed = parseAnalysisResponse(analysisOk);
    expect(parsed.externalId).toBe("B0TESTASIN");
    expect((parsed as { unexpectedServerField?: boolean }).unexpectedServerField).toBe(true);
    const noEvidence = { ...analysisOk };
    delete (noEvidence as { evidence?: unknown }).evidence;
    const synthesized = parseAnalysisResponse(noEvidence);
    expect(synthesized.evidence.eligibleCount).toBe(10);
  });

  it("parseHistoryResponse validates points/daily shapes", () => {
    const parsed = parseHistoryResponse(historyOk);
    expect(parsed.daily[0]?.medianPriceCents).toBe(29900);
    expect(() => parseHistoryResponse({ ...historyOk, daily: "x" })).toThrow(ApiMalformedError);
  });
});
