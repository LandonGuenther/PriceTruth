import { describe, expect, it } from "vitest";
import { evaluateAnomaly } from "../src/services/dataQuality/anomaly.js";

const T0 = Date.parse("2026-09-10T12:00:00Z");
const day = 86_400_000;
const at = (offsetMs: number) => new Date(T0 + offsetMs);
const ctx = (priceCents: number, backDays: number, currency = "USD") => ({
  priceCents,
  currency,
  effectiveAt: at(-backDays * day),
});
const cand = (priceCents: number, trustClass = "CLIENT_REPORTED", currency = "USD") => ({
  priceCents,
  currency,
  trustClass,
  effectiveAt: at(0),
});

describe("anomaly engine", () => {
  it("accepts a normal move", () => {
    const v = evaluateAnomaly(cand(98000), [ctx(99000, 1), ctx(100000, 2), ctx(101000, 3)]);
    expect(v).toEqual({ verdict: "ACCEPT", reasons: [] });
  });

  it("accepts anything with no context", () => {
    expect(evaluateAnomaly(cand(1), []).verdict).toBe("ACCEPT");
  });

  it("trusted sources are never quarantined", () => {
    const v = evaluateAnomaly(cand(1, "SERVER_FETCHED", "EUR"), [
      ctx(99900, 1),
      ctx(99900, 2),
      ctx(99900, 3),
    ]);
    expect(v.verdict).toBe("ACCEPT");
  });

  it("currency_change quarantines", () => {
    const v = evaluateAnomaly(cand(99900, "CLIENT_REPORTED", "EUR"), [ctx(99900, 1)]);
    expect(v.verdict).toBe("QUARANTINE");
    expect(v.reasons).toContain("currency_change");
  });

  it("large_move_vs_recent_median: >60% off median with ≥3 context rows", () => {
    const context = [ctx(99900, 1), ctx(100000, 2), ctx(100100, 3)];
    expect(evaluateAnomaly(cand(39000), context).reasons).toContain("large_move_vs_recent_median");
    expect(evaluateAnomaly(cand(75000), context).verdict).toBe("ACCEPT"); // 25% move ok
  });

  it("contradicts_recent_cluster: tight cluster (≤5% spread) + >25% move, needs ≥5", () => {
    const tight = [99900, 100000, 100100, 99800, 100000].map((p, i) => ctx(p, i + 1));
    expect(evaluateAnomaly(cand(74000), tight).reasons).toContain("contradicts_recent_cluster");
    const sparse = tight.slice(0, 4);
    expect(evaluateAnomaly(cand(74000), sparse).reasons).not.toContain(
      "contradicts_recent_cluster",
    );
  });

  it("rapid_oscillation: ≥3 direction changes ≥20% within 24h", () => {
    const h = 3600_000;
    const context = [
      { priceCents: 40000, currency: "USD", effectiveAt: at(-4 * h) },
      { priceCents: 90000, currency: "USD", effectiveAt: at(-3 * h) },
      { priceCents: 40000, currency: "USD", effectiveAt: at(-2 * h) },
      { priceCents: 90000, currency: "USD", effectiveAt: at(-1 * h) },
    ];
    const v = evaluateAnomaly(cand(40000), context); // down again: 4th change
    expect(v.reasons).toContain("rapid_oscillation");
    // moves <20% don't count
    const flat = context.map((c) => ({ ...c, priceCents: 60000 }));
    expect(evaluateAnomaly(cand(61000), flat).reasons).not.toContain("rapid_oscillation");
  });
});
