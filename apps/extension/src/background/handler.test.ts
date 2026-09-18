import { beforeEach, describe, expect, it } from "vitest";
import type { AnalysisResponse, HistoryResponse, RetailerObservation } from "@pricetruth/shared";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { ApiError, type IngestResponse } from "./api.js";
import {
  handleMessage,
  handleNavigationStart,
  peekGeneration,
  resetHandlerEphemeralState,
  type HandlerDeps,
  type HandlerStorage,
} from "./handler.js";
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
  schemaVersion: 1,
  priceType: "STANDARD",
  referenceType: "UNKNOWN",
  extractorVersion: "1.0.0",
};

const observationB: RetailerObservation = {
  ...observation,
  externalId: "B0OTHERASI",
  url: "https://www.amazon.com/dp/B0OTHERASI",
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

type Scheduled = { fn: () => void; cancelled: boolean };

function makeDeps(apiImpl: {
  postObservation?: () => Promise<IngestResponse>;
  getAnalysis?: () => Promise<AnalysisResponse>;
  getHistory?: () => Promise<HistoryResponse>;
}) {
  const store = new Map<string, TabState | boolean>();
  const calls: string[] = [];
  const storage: HandlerStorage = {
    get: async (key) => {
      calls.push(`get:${key}`);
      const v = store.get(key);
      return v !== undefined ? { [key]: v } : {};
    },
    set: async (values) => {
      for (const [k, v] of Object.entries(values)) {
        if (typeof v === "object" && v && "status" in v) {
          calls.push(`set:${k}:${(v as TabState).status}`);
        } else {
          calls.push(`set:${k}:${String(v)}`);
        }
        store.set(k, v as TabState | boolean);
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
  const scheduled: Scheduled[] = [];
  const cancelledHandles: unknown[] = [];
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
      const entry: Scheduled = { fn, cancelled: false };
      scheduled.push(entry);
      return entry;
    },
    cancelSchedule: (handle) => {
      cancelledHandles.push(handle);
      (handle as Scheduled).cancelled = true;
    },
  };
  const flushScheduled = () => {
    const batch = scheduled.splice(0);
    for (const entry of batch) {
      if (!entry.cancelled) entry.fn();
    }
  };
  return { deps, store, calls, scheduled, cancelledHandles, pingCalls, flags, flushScheduled };
}

beforeEach(() => {
  resetHandlerEphemeralState();
});

describe("handleMessage", () => {
  it("success: loading → ready with analysis/history/ingest", async () => {
    const { deps, store, calls } = makeDeps({});
    await handleMessage({ type: "pt/observation", observation }, 7, deps);
    expect(calls).toEqual([
      `set:${tabStateKey(7)}:loading`,
      `set:${tabStateKey(7)}:loading`,
      `set:${tabStateKey(7)}:ready`,
    ]);
    const s = store.get(tabStateKey(7));
    expect(s && typeof s === "object" && "status" in s ? s.status : null).toBe("ready");
    if (s && typeof s === "object" && s.status === "ready") {
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
    expect(s && typeof s === "object" ? s.status : null).toBe("error");
    if (s && typeof s === "object" && s.status === "error") {
      expect(s.observation).toBe(observation);
      expect(s.message).toContain("returned an error");
      expect(s.kind).toBe("api");
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
      warnings: [],
    });
  });

  it("ambiguous_price → ambiguous state and does not post observation", async () => {
    let posted = 0;
    const { deps, store } = makeDeps({
      postObservation: async () => {
        posted += 1;
        return { accepted: true, duplicate: false, listingId: "l", observationId: "o" };
      },
    });
    await handleMessage(
      {
        type: "pt/extraction-failed",
        retailer: "bestbuy",
        reason: "ambiguous_price",
        url: "https://www.bestbuy.com/site/x/6418599.p",
        warnings: ["JSON-LD price conflicts with DOM price"],
      },
      8,
      deps,
    );
    expect(posted).toBe(0);
    const s = store.get(tabStateKey(8));
    expect(s && typeof s === "object" ? s.status : null).toBe("ambiguous");
    if (s && typeof s === "object" && s.status === "ambiguous") {
      expect(s.retailer).toBe("bestbuy");
      expect(s.warnings).toEqual(["JSON-LD price conflicts with DOM price"]);
      expect(s.message).toContain("could not confidently determine");
    }
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
    expect(s && typeof s === "object" ? s.status : null).toBe("ready");
    if (s && typeof s === "object" && s.status === "ready") expect(s.ingest.duplicate).toBe(true);
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
    expect(store.get(tabStateKey(5)) && (store.get(tabStateKey(5)) as TabState).status).toBe(
      "error",
    );
    fail = false;
    await handleMessage({ type: "pt/retry", tabId: 5 }, undefined, deps);
    expect(store.get(tabStateKey(5)) && (store.get(tabStateKey(5)) as TabState).status).toBe(
      "ready",
    );
    expect(calls).toContain(`set:${tabStateKey(5)}:loading`);
  });

  it("A then B race: slow A cannot overwrite faster B", async () => {
    let resolveA!: (v: IngestResponse) => void;
    const aGate = new Promise<IngestResponse>((r) => {
      resolveA = r;
    });
    let postCount = 0;
    const { deps, store } = makeDeps({
      postObservation: async () => {
        postCount += 1;
        if (postCount === 1) return aGate;
        return { accepted: true, duplicate: false, listingId: "lB", observationId: "oB" };
      },
      getAnalysis: async () =>
        ({ ...analysis, externalId: observationB.externalId }) as unknown as AnalysisResponse,
    });

    const pA = handleMessage({ type: "pt/observation", observation }, 42, deps);
    // Let A reach the awaiting postObservation gate.
    await Promise.resolve();
    await Promise.resolve();
    expect(peekGeneration(42)).toBe(1);
    expect((store.get(tabStateKey(42)) as TabState).status).toBe("loading");

    const pB = handleMessage({ type: "pt/observation", observation: observationB }, 42, deps);
    await pB;
    const afterB = store.get(tabStateKey(42)) as TabState;
    expect(afterB.status).toBe("ready");
    if (afterB.status === "ready") {
      expect(afterB.observation.externalId).toBe("B0OTHERASI");
      expect(afterB.generation).toBe(2);
    }

    resolveA({ accepted: true, duplicate: false, listingId: "lA", observationId: "oA" });
    await pA;

    const final = store.get(tabStateKey(42)) as TabState;
    expect(final.status).toBe("ready");
    if (final.status === "ready") {
      expect(final.observation.externalId).toBe("B0OTHERASI");
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
    const { deps, store, scheduled, pingCalls, flags, flushScheduled } = makeDeps({});
    flags.pingResult = false;
    store.set(tabStateKey(11), ready);

    const p = handleNavigationStart(11, deps);
    expect(pingCalls).toHaveLength(0); // not yet - waiting on schedule
    expect(scheduled).toHaveLength(1);
    flushScheduled();
    await p;

    expect(pingCalls).toEqual([11]);
    expect(store.get(tabStateKey(11))).toEqual({ status: "idle" });
  });

  it("ping true → ready state preserved (Amazon ghost loading events)", async () => {
    const { deps, store, flushScheduled } = makeDeps({});
    store.set(tabStateKey(12), ready);
    const p = handleNavigationStart(12, deps);
    flushScheduled();
    await p;
    expect(store.get(tabStateKey(12))).toBe(ready);
  });

  it("state loading + ping false → untouched (ingest in flight)", async () => {
    const { deps, store, flags, flushScheduled } = makeDeps({});
    flags.pingResult = false;
    const loading: TabState = {
      status: "loading",
      observation,
      phase: "submitting",
      generation: 1,
    };
    store.set(tabStateKey(13), loading);
    const p = handleNavigationStart(13, deps);
    flushScheduled();
    await p;
    expect(store.get(tabStateKey(13))).toBe(loading);
  });

  it("overlapping navigation cancels the prior timer; only latest epoch pings", async () => {
    const { deps, store, scheduled, cancelledHandles, pingCalls, flags, flushScheduled } = makeDeps(
      {},
    );
    flags.pingResult = false;
    store.set(tabStateKey(20), ready);

    const p1 = handleNavigationStart(20, deps);
    expect(scheduled).toHaveLength(1);
    const firstHandle = scheduled[0];

    const p2 = handleNavigationStart(20, deps);
    expect(cancelledHandles).toContain(firstHandle);
    expect(firstHandle?.cancelled).toBe(true);
    expect(scheduled).toHaveLength(2);

    flushScheduled();
    await Promise.all([p1, p2]);

    expect(pingCalls).toEqual([20]); // only the latest epoch pings
    expect(store.get(tabStateKey(20))).toEqual({ status: "idle" });
  });
});
