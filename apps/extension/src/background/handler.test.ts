import { beforeEach, describe, expect, it } from "vitest";
import type { AnalysisResponse, HistoryResponse, RetailerObservation } from "@pricetruth/shared";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { ApiError, ApiTimeoutError, type IngestResponse } from "./api.js";
import {
  handleMessage,
  handleNavigationStart,
  peekGeneration,
  resetHandlerEphemeralState,
  type HandlerDeps,
  type HandlerStorage,
} from "./handler.js";
import { tabStateKey, type TabState } from "../messages.js";

const NOW = new Date("2025-06-30T12:00:00.000Z");

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

const otherObservation: RetailerObservation = {
  ...observation,
  externalId: "B0OTHERASIN",
  url: "https://www.amazon.com/dp/B0OTHERASIN",
  title: "Other Widget",
  priceCents: 19900,
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
      (async () => ({
        accepted: true,
        duplicate: false,
        listingId: "l",
        observationId: "o",
      })),
    getAnalysis: apiImpl.getAnalysis ?? (async () => analysis),
    getHistory: apiImpl.getHistory ?? (async () => history),
  };
  const scheduled: Array<{ fn: () => void; handle: number }> = [];
  let nextHandle = 1;
  const pingCalls: number[] = [];
  const flags = { pingResult: true };
  const deps: HandlerDeps = {
    api,
    storage,
    now: () => NOW,
    ping: async (tabId) => {
      pingCalls.push(tabId);
      return flags.pingResult;
    },
    schedule: (fn) => {
      const handle = nextHandle++;
      scheduled.push({ fn, handle });
      return handle;
    },
    cancelSchedule: (handle) => {
      const idx = scheduled.findIndex((s) => s.handle === handle);
      if (idx >= 0) scheduled.splice(idx, 1);
    },
  };
  return { deps, store, calls, scheduled, pingCalls, flags };
}

beforeEach(() => {
  resetHandlerEphemeralState();
});

describe("handleMessage", () => {
  it("success: loading → ready with analysis/history/ingest", async () => {
    const { deps, store, calls } = makeDeps({});
    await handleMessage({ type: "pt/observation", observation }, 7, deps);
    expect(calls.filter((c) => c.startsWith("set:"))).toEqual([
      `set:${tabStateKey(7)}:loading`,
      `set:${tabStateKey(7)}:loading`,
      `set:${tabStateKey(7)}:ready`,
    ]);
    const s = store.get(tabStateKey(7));
    expect(s?.status).toBe("ready");
    if (s?.status === "ready") {
      expect(s.analysis).toBe(analysis);
      expect(s.history).toBe(history);
      expect(s.ingest).toEqual({ accepted: true, duplicate: false });
      expect(s.updatedAt).toBe(NOW.toISOString());
      expect(s.generation).toBe(1);
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
      expect(s.message).toMatch(/returned an error/i);
      expect(s.kind).toBe("api");
    }
  });

  it("timeout → error with timeout kind", async () => {
    const { deps, store } = makeDeps({
      postObservation: async () => {
        throw new ApiTimeoutError();
      },
    });
    await handleMessage({ type: "pt/observation", observation }, 3, deps);
    const s = store.get(tabStateKey(3));
    expect(s?.status).toBe("error");
    if (s?.status === "error") expect(s.kind).toBe("timeout");
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
    expect(store.get(tabStateKey(4))).toMatchObject({
      status: "unsupported",
      retailer: "bestbuy",
      reason: "no_price",
    });
  });

  it("ambiguous_price → ambiguous state (no ingest)", async () => {
    const { deps, store, calls } = makeDeps({});
    await handleMessage(
      {
        type: "pt/extraction-failed",
        retailer: "amazon",
        reason: "ambiguous_price",
        url: "https://www.amazon.com/dp/B0AMBIGXXX",
        warnings: ["multiple prices"],
      },
      8,
      deps,
    );
    expect(store.get(tabStateKey(8))?.status).toBe("ambiguous");
    expect(calls.some((c) => c.includes(":ready"))).toBe(false);
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
    const { deps, store } = makeDeps({
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
    expect(peekGeneration(5)).toBe(2);
  });

  it("stale observation cannot overwrite a newer product's ready state", async () => {
    let releaseA: () => void = () => undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let serving: "a" | "b" = "a";
    const { deps, store } = makeDeps({
      postObservation: async () => {
        if (serving === "a") await gateA;
        return { accepted: true, duplicate: false, listingId: "l", observationId: "o" };
      },
      getAnalysis: async () =>
        ({
          ...analysis,
          externalId: serving === "a" ? observation.externalId : otherObservation.externalId,
        }) as AnalysisResponse,
    });

    const pendingA = handleMessage({ type: "pt/observation", observation }, 1, deps);
    // Yield so A reaches the gated postObservation.
    await Promise.resolve();
    serving = "b";
    await handleMessage({ type: "pt/observation", observation: otherObservation }, 1, deps);

    const mid = store.get(tabStateKey(1));
    expect(mid?.status).toBe("ready");
    if (mid?.status === "ready") {
      expect(mid.observation.externalId).toBe("B0OTHERASIN");
    }

    releaseA();
    await pendingA;

    const final = store.get(tabStateKey(1));
    expect(final?.status).toBe("ready");
    if (final?.status === "ready") {
      expect(final.observation.externalId).toBe("B0OTHERASIN");
      expect(final.generation).toBe(2);
    }
  });
});

describe("handleNavigationStart", () => {
  const ready: TabState = {
    status: "ready",
    observation,
    analysis,
    history,
    ingest: { accepted: true, duplicate: false },
    updatedAt: "",
    generation: 1,
  };

  it("pings only after the scheduled delay; ping false → state idle", async () => {
    const { deps, store, scheduled, pingCalls, flags } = makeDeps({});
    flags.pingResult = false;
    store.set(tabStateKey(11), ready);

    const pending = handleNavigationStart(11, deps);
    expect(pingCalls).toHaveLength(0);
    expect(scheduled).toHaveLength(1);
    for (const s of scheduled.splice(0)) s.fn();
    await pending;

    expect(pingCalls).toEqual([11]);
    expect(store.get(tabStateKey(11))).toEqual({ status: "idle" });
  });

  it("ping true → ready state preserved (Amazon ghost loading events)", async () => {
    const { deps, store, scheduled } = makeDeps({});
    store.set(tabStateKey(12), ready);
    const pending = handleNavigationStart(12, deps);
    for (const s of scheduled.splice(0)) s.fn();
    await pending;
    expect(store.get(tabStateKey(12))).toBe(ready);
  });

  it("state loading + ping false → untouched (ingest in flight)", async () => {
    const { deps, store, scheduled, flags } = makeDeps({});
    flags.pingResult = false;
    const loading: TabState = {
      status: "loading",
      observation,
      phase: "submitting",
      generation: 1,
    };
    store.set(tabStateKey(13), loading);
    const pending = handleNavigationStart(13, deps);
    for (const s of scheduled.splice(0)) s.fn();
    await pending;
    expect(store.get(tabStateKey(13))).toBe(loading);
  });

  it("overlapping navigation cancels the previous ping", async () => {
    const { deps, store, scheduled, flags } = makeDeps({});
    flags.pingResult = false;
    store.set(tabStateKey(14), ready);

    const first = handleNavigationStart(14, deps);
    expect(scheduled).toHaveLength(1);
    const second = handleNavigationStart(14, deps);
    expect(scheduled).toHaveLength(1);
    for (const s of scheduled.splice(0)) s.fn();
    await Promise.all([first, second]);
    expect(store.get(tabStateKey(14))).toEqual({ status: "idle" });
  });
});
