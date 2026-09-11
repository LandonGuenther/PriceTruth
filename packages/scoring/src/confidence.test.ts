import { describe, expect, it } from "vitest";
import { analyzeListing } from "./analyze.js";
import { computeConfidence } from "./confidence.js";
import { collapseToDailySeries } from "./daily.js";
import { computeStats } from "./stats.js";
import type { ScoringObservation } from "./types.js";

/** One observation per day for `days` consecutive days ending at `endDay`. */
function series(days: number, endDay: string, price = 30000): ScoringObservation[] {
  const end = new Date(`${endDay}T12:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end.getTime() - i * 86_400_000);
    return {
      priceCents: price,
      referencePriceCents: null,
      effectiveAt: d.toISOString(),
      sourceKey: "test",
    };
  });
}

function confidenceOf(observations: ScoringObservation[], asOf: Date) {
  const stats = computeStats(observations, asOf);
  const daily = collapseToDailySeries(observations);
  return computeConfidence(stats, daily, asOf);
}

describe("computeConfidence base levels", () => {
  const asOf = new Date("2025-06-30T12:00:00Z");

  it("INSUFFICIENT when observationCount < 3", () => {
    const obs = series(2, "2025-06-30");
    expect(confidenceOf(obs, asOf).level).toBe("INSUFFICIENT");
  });

  it("INSUFFICIENT when uniqueDays < 3 even with many observations", () => {
    const obs = [...series(2, "2025-06-30"), ...series(2, "2025-06-30")];
    expect(confidenceOf(obs, asOf).level).toBe("INSUFFICIENT");
  });

  it("INSUFFICIENT when coverageDays < 7", () => {
    const obs = series(5, "2025-06-30"); // 5 days, coverage 5
    expect(confidenceOf(obs, asOf).level).toBe("INSUFFICIENT");
  });

  it("LOW at 10+ days history / coverage 30 boundary", () => {
    // coverageDays 7..29 with uniqueDays >= 3 → LOW
    expect(confidenceOf(series(7, "2025-06-30"), asOf).level).toBe("LOW");
    // uniqueDays < 10 still LOW even with coverage >= 30
    const sparse = [
      {
        priceCents: 100,
        referencePriceCents: null,
        effectiveAt: "2025-06-01T00:00:00Z",
        sourceKey: "t",
      },
      {
        priceCents: 100,
        referencePriceCents: null,
        effectiveAt: "2025-06-15T00:00:00Z",
        sourceKey: "t",
      },
      {
        priceCents: 100,
        referencePriceCents: null,
        effectiveAt: "2025-06-30T00:00:00Z",
        sourceKey: "t",
      },
    ];
    expect(confidenceOf(sparse, asOf).level).toBe("LOW");
  });

  it("MEDIUM when uniqueDays >= 10 and coverage >= 30 but below HIGH bar", () => {
    expect(confidenceOf(series(30, "2025-06-30"), asOf).level).toBe("MEDIUM");
    expect(confidenceOf(series(89, "2025-06-30"), asOf).level).toBe("MEDIUM");
  });

  it("HIGH when uniqueDays >= 30 and coverage >= 90", () => {
    expect(confidenceOf(series(90, "2025-06-30"), asOf).level).toBe("HIGH");
  });
});

describe("computeConfidence downgrades", () => {
  it("staleness: newest observation older than 14 days drops one level", () => {
    const obs = series(90, "2025-06-15");
    const asOf = new Date("2025-06-30T12:00:00Z"); // 15 days after newest
    const result = confidenceOf(obs, asOf);
    expect(result.level).toBe("MEDIUM"); // HIGH - 1
    expect(result.reasons.some((r) => r.includes("14"))).toBe(true);
  });

  it("no staleness downgrade at exactly 14 days", () => {
    const obs = series(90, "2025-06-16");
    const asOf = new Date("2025-06-30T12:00:00Z"); // exactly 14 days
    expect(confidenceOf(obs, asOf).level).toBe("HIGH");
  });

  it("dispersion: (Q3 - Q1) / medianAll > 0.5 drops one level", () => {
    // Half the days at 10000, half at 30000 → IQR 20000 / median 20000 = 1.0 > 0.5
    const obs = [...series(50, "2025-06-30", 10000), ...series(50, "2025-05-12", 30000)];
    const result = confidenceOf(obs, new Date("2025-06-30T12:00:00Z"));
    expect(result.level).toBe("MEDIUM"); // HIGH - 1
    expect(result.reasons.some((r) => r.includes("dispersed"))).toBe(true);
  });

  it("staleness and dispersion stack; never below INSUFFICIENT", () => {
    const obs = [...series(5, "2025-06-10", 10000), ...series(4, "2025-05-01", 40000)];
    // LOW base (uniqueDays 9, coverage 41), stale (20 days) → INSUFFICIENT, dispersed → still INSUFFICIENT
    const result = confidenceOf(obs, new Date("2025-06-30T12:00:00Z"));
    expect(result.level).toBe("INSUFFICIENT");
  });

  it("always returns non-empty reasons", () => {
    expect(confidenceOf([], new Date()).reasons.length).toBeGreaterThan(0);
    expect(
      confidenceOf(series(120, "2025-06-30"), new Date("2025-06-30T12:00:00Z")).reasons.length,
    ).toBeGreaterThan(0);
  });
});

describe("scores under INSUFFICIENT confidence", () => {
  it("returns null scores labelled Limited history when observations exist", () => {
    const result = analyzeListing({
      observations: series(2, "2025-06-30"),
      asOf: new Date("2025-06-30T12:00:00Z"),
    });
    expect(result.confidence.level).toBe("INSUFFICIENT");
    expect(result.dealScore.score).toBeNull();
    expect(result.dealScore.label).toBe("Limited history");
    expect(result.discountIntegrity.score).toBeNull();
    expect(result.discountIntegrity.label).toBe("Limited history");
  });

  it("returns Insufficient evidence when there are no observations", () => {
    const result = analyzeListing({ observations: [], asOf: new Date("2025-06-30T12:00:00Z") });
    expect(result.dealScore.label).toBe("Insufficient evidence");
    expect(result.discountIntegrity.label).toBe("Insufficient evidence");
  });
});
