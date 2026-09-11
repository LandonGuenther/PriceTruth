import { describe, expect, it } from "vitest";
import type { AnalysisResponse, HistoryResponse, RetailerObservation } from "@pricetruth/shared";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { ApiError, type IngestResponse } from "./api.js";
import { handleMessage, type HandlerDeps, type HandlerStorage } from "./handler.js";
import { tabStateKey, type TabState } from "../messages.js";

const NOW = new Date("2025-06-30T12:00:00Z");

const observation: RetailerObservation = {
  retailer: "amazon",
  externalId: "B0TESTASIN",
  url: "https://www.amazon.com/dp/B0TESTASIN",
  title: "Widget",
  priceCents: 29900,
  referencePriceCents: 49900,
  currency: "USD",
  source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
  observedAt: NOW.toISOString(),
};

const analysis = {
  retailer: "amazon",
  externalId: "B0TESTASIN",
  confidence: { level: "HIGH", reasons: ["x"] },
  dealScore: { score: 78, label: "Better than typical", reasons: [] },
  discountIntegrity: {
    score: 9,
    label: "Reference price not supported by our observations",
    reasons: [],
    advertisedDiscountPct: 40.1,
    actualDiscountVsTypicalPct: 6.3,
  },
} as unknown as AnalysisResponse;

const history = { points: [], daily: [] } as unknown as HistoryResponse;

function makeDeps(apiImpl: {
  postObservation?: () => Promise<IngestResponse>;
  getAnalysis?: () => Promise<AnalysisResponse>;
  getHistory?: () => Promise<HistoryResponse>;
}) {
  const store = new Map<string, TabState>();
  const calls: string[] = [];
  const storage: HandlerStorage = {
    get: async (key) => {
      calls.push(`get:${key}`);
      const v = store.get(key);
      return v ? { [key]: v } : {};
    },
    set: async (values) => {
      for (const [k, v] of Object.entries(values)) {
        calls.push(`set:${k}:${v.status}`);
        store.set(k, v);
      }
    },
    remove: async (key) => {
      store.delete(key);
    },
  };
  const api = {
    postObservation:
      apiImpl.postObservation ??
      (async () => ({ accepted: true, duplicate: false, listingId: "l", observationId: "o" })),
    getAnalysis: apiImpl.getAnalysis ?? (async () => analysis),
    getHistory: apiImpl.getHistory ?? (async () => history),
  };
  const deps: HandlerDeps = { api, storage, now: () => NOW };
  return { deps, store, calls };
}

describe("handleMessage", () => {
  it("success: loading → ready with analysis/history/ingest", async () => {
    const { deps, store, calls } = makeDeps({});
    await handleMessage({ type: "pt/observation", observation }, 7, deps);
    expect(calls).toEqual([`set:${tabStateKey(7)}:loading`, `set:${tabStateKey(7)}:ready`]);
    const s = store.get(tabStateKey(7));
    expect(s?.status).toBe("ready");
    if (s?.status === "ready") {
      expect(s.analysis).toBe(analysis);
      expect(s.history).toBe(history);
      expect(s.ingest).toEqual({ accepted: true, duplicate: false });
      expect(s.updatedAt).toBe(NOW.toISOString());
    }
  });

  it("api failure → error state keeping the observation", async () => {
    const { deps, store } = makeDeps({
      postObservation: async () => {
        throw new ApiError(500, "boom");
      },
    });
    await handleMessage({ type: "pt/observation", observation }, 3, deps);
    const s = store.get(tabStateKey(3));
    expect(s?.status).toBe("error");
    if (s?.status === "error") {
      expect(s.observation).toBe(observation);
      expect(s.message).toContain("Could not reach");
    }
  });

  it("extraction-failed → unsupported with reason", async () => {
    const { deps, store } = makeDeps({});
    await handleMessage(
      {
        type: "pt/extraction-failed",
        retailer: "bestbuy",
        reason: "no_price",
        url: "https://www.bestbuy.com/site/x/6418599.p",
        warnings: [],
      },
      4,
      deps,
    );
    expect(store.get(tabStateKey(4))).toEqual({
      status: "unsupported",
      retailer: "bestbuy",
      reason: "no_price",
    });
  });

  it("duplicate ingest still fetches analysis and lands ready", async () => {
    const { deps, store } = makeDeps({
      postObservation: async () => ({
        accepted: false,
        duplicate: true,
        listingId: "l",
        observationId: "o",
      }),
    });
    await handleMessage({ type: "pt/observation", observation }, 9, deps);
    const s = store.get(tabStateKey(9));
    expect(s?.status).toBe("ready");
    if (s?.status === "ready") expect(s.ingest.duplicate).toBe(true);
  });

  it("pt/retry re-runs the stored observation after an error", async () => {
    let fail = true;
    const { deps, store, calls } = makeDeps({
      postObservation: async () => {
        if (fail) throw new ApiError(500, "down");
        return { accepted: true, duplicate: false, listingId: "l", observationId: "o" };
      },
    });
    await handleMessage({ type: "pt/observation", observation }, 5, deps);
    expect(store.get(tabStateKey(5))?.status).toBe("error");
    fail = false;
    await handleMessage({ type: "pt/retry", tabId: 5 }, undefined, deps);
    expect(store.get(tabStateKey(5))?.status).toBe("ready");
    expect(calls).toContain(`set:${tabStateKey(5)}:loading`);
  });
});
