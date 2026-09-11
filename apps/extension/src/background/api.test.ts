import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  ApiError,
  ApiMalformedError,
  ApiUnsupportedVersionError,
  API_VERSION_HEADER,
  parseAnalysisResponse,
  parseHistoryResponse,
  parseIngestResponse,
} from "./api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const analysisFixture = {
  retailer: "amazon",
  externalId: "B0TESTASIN",
  title: "Test Widget",
  url: "https://www.amazon.com/dp/B0TESTASIN",
  currency: "USD",
  currentPriceCents: 19900,
  referencePriceCents: 24900,
  observedAt: "2025-06-30T12:00:00.000Z",
  typical: { cents: 21900, window: "90d" },
  stats: {
    observationCount: 10,
    uniqueDays: 10,
    coverageDays: 30,
    newestObservedAt: "2025-06-30T12:00:00.000Z",
    oldestObservedAt: "2025-06-01T12:00:00.000Z",
    median30Cents: 21900,
    median90Cents: 21900,
    median180Cents: 21900,
    medianAllCents: 21900,
    low90Cents: 18900,
    low180Cents: 18900,
    recordedLowCents: 18900,
    recordedHighCents: 24900,
    pricePercentile: 0.4,
    shareAtOrBelowCurrent: 0.5,
    referencePricePercentile: 90,
    shareNearReference: 0.1,
  },
  confidence: { level: "MEDIUM", reasons: [] },
  discountIntegrity: {
    score: 40,
    label: "Weak reference support",
    reasons: ["Reference rarely observed"],
    advertisedDiscountPct: 20,
    actualDiscountVsTypicalPct: 9,
  },
  dealScore: { score: 70, label: "Better than typical", reasons: [] },
  computedAt: "2025-06-30T12:00:00.000Z",
};

const historyFixture = {
  retailer: "amazon",
  externalId: "B0TESTASIN",
  days: 30,
  points: [],
  daily: [{ day: "2025-06-30", medianPriceCents: 19900 }],
};

const ingestFixture = {
  accepted: true,
  duplicate: false,
  listingId: "listing-1",
  observationId: "obs-1",
};

describe("ApiClient", () => {
  it("calls fetch unbound-safe: default impl calls globalThis.fetch with global this", async () => {
    const spy = vi.fn(function (this: unknown) {
      // Regression guard: a stored bare `fetch` is called with a non-global
      // `this` and throws "Illegal invocation" in Chrome.
      expect(this === undefined || this === globalThis).toBe(true);
      return Promise.resolve(new Response(JSON.stringify(analysisFixture)));
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

  it("rejects malformed JSON bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{not-json", { status: 200 }))),
    );
    const client = new ApiClient("http://x");
    await expect(client.getAnalysis("amazon", "B0TESTASIN")).rejects.toBeInstanceOf(
      ApiMalformedError,
    );
  });

  it("rejects unsupported API version headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(analysisFixture), {
            status: 200,
            headers: { [API_VERSION_HEADER]: "9.0.0" },
          }),
        ),
      ),
    );
    const client = new ApiClient("http://x");
    await expect(client.getAnalysis("amazon", "B0TESTASIN")).rejects.toBeInstanceOf(
      ApiUnsupportedVersionError,
    );
  });

  it("parses ingest responses and sends client version header", async () => {
    const spy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(ingestFixture))));
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x", undefined, "1.2.3");
    const res = await client.postObservation({
      retailer: "amazon",
      externalId: "B0TESTASIN",
      url: "https://www.amazon.com/dp/B0TESTASIN",
      title: "T",
      priceCents: 100,
      currency: "USD",
      source: "extension:content-script",
      observedAt: "2025-06-30T12:00:00.000Z",
    });
    expect(res).toEqual(ingestFixture);
    const headers = spy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["x-pricetruth-client-version"]).toBe("1.2.3");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("does not retry failed requests", async () => {
    const spy = vi.fn(() => Promise.resolve(new Response("nope", { status: 503 })));
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x");
    await expect(client.getHistory("amazon", "B0TESTASIN")).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("response parsers", () => {
  it("parseIngestResponse requires booleans and ids", () => {
    expect(parseIngestResponse(ingestFixture)).toEqual(ingestFixture);
    expect(() => parseIngestResponse({ accepted: true })).toThrow(ApiMalformedError);
  });

  it("parseAnalysisResponse tolerates unknown extra fields", () => {
    const parsed = parseAnalysisResponse({ ...analysisFixture, futureField: 123 });
    expect(parsed.currentPriceCents).toBe(19900);
  });

  it("parseAnalysisResponse rejects newer schemaVersion", () => {
    expect(() =>
      parseAnalysisResponse({ ...analysisFixture, schemaVersion: 99 }),
    ).toThrow(ApiUnsupportedVersionError);
  });

  it("parseHistoryResponse requires daily and points arrays", () => {
    expect(parseHistoryResponse(historyFixture).daily).toHaveLength(1);
    expect(() => parseHistoryResponse({ retailer: "amazon", externalId: "x" })).toThrow(
      ApiMalformedError,
    );
  });
});
