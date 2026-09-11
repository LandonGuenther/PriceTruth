import { describe, expect, it } from "vitest";
import { computeStats, dailyPointsInWindow } from "./stats.js";
import type { ScoringObservation } from "./types.js";

const obs = (
  day: string,
  priceCents: number,
  referencePriceCents: number | null = null,
  time = "T12:00:00Z",
): ScoringObservation => ({
  priceCents,
  referencePriceCents,
  observedAt: `${day}${time}`,
  source: "test",
});

describe("dailyPointsInWindow", () => {
  const daily = [
    { day: "2025-01-01", medianPriceCents: 100 },
    { day: "2025-01-10", medianPriceCents: 100 },
    { day: "2025-01-29", medianPriceCents: 100 },
    { day: "2025-01-30", medianPriceCents: 100 },
  ];
  const asOf = new Date("2025-01-30T15:00:00Z");

  it("includes boundary days: last 30 days means day diff 0..29", () => {
    const pts = dailyPointsInWindow(daily, asOf, 30);
    // diff(01-01, 01-30) = 29 → in; hypothetical day 31 days back would be out.
    expect(pts.map((p) => p.day)).toEqual(["2025-01-01", "2025-01-10", "2025-01-29", "2025-01-30"]);
    const pts2 = dailyPointsInWindow(
      [{ day: "2024-12-31", medianPriceCents: 100 }, ...daily],
      asOf,
      30,
    );
    expect(pts2.map((p) => p.day)).not.toContain("2024-12-31"); // diff = 30 → out
  });
});

describe("computeStats", () => {
  it("computes counts, coverage and ISO bounds", () => {
    const stats = computeStats(
      [obs("2025-01-01", 100), obs("2025-01-01", 300, null, "T13:00:00Z"), obs("2025-01-08", 200)],
      new Date("2025-01-08T00:00:00Z"),
    );
    expect(stats.observationCount).toBe(3);
    expect(stats.uniqueDays).toBe(2);
    expect(stats.coverageDays).toBe(8);
    expect(stats.oldestObservedAt).toBe("2025-01-01T12:00:00Z");
    expect(stats.newestObservedAt).toBe("2025-01-08T12:00:00Z");
    expect(stats.medianAllCents).toBe(200); // median(200, 200)? daily medians: 200, 200
  });

  it("returns null window medians when fewer than 3 daily points", () => {
    const stats = computeStats(
      [obs("2025-01-01", 100), obs("2025-01-02", 200)],
      new Date("2025-01-02T00:00:00Z"),
    );
    expect(stats.median30Cents).toBeNull();
    expect(stats.median90Cents).toBeNull();
    expect(stats.median180Cents).toBeNull();
    expect(stats.medianAllCents).toBe(150);
  });

  it("averages two middle values for even-count medians", () => {
    const stats = computeStats(
      [
        obs("2025-01-01", 100),
        obs("2025-01-02", 200),
        obs("2025-01-03", 300),
        obs("2025-01-04", 405),
      ],
      new Date("2025-01-04T00:00:00Z"),
    );
    expect(stats.medianAllCents).toBe(250); // (200+300)/2
    expect(stats.median30Cents).toBe(250);
    expect(stats.median90Cents).toBe(250); // same 4 daily points are inside the 90d window
  });

  it("computes percentiles over the daily series", () => {
    const observations: ScoringObservation[] = [];
    for (let i = 1; i <= 10; i++) {
      observations.push(obs(`2025-01-${String(i).padStart(2, "0")}`, i * 100));
    }
    const stats = computeStats(observations, new Date("2025-01-10T00:00:00Z"));
    // current = 1000; days below: 9 → percentile 90; at-or-below: 10 → 100.
    expect(stats.pricePercentile).toBe(90);
    expect(stats.shareAtOrBelowCurrent).toBe(100);
    expect(stats.recordedLowCents).toBe(100);
    expect(stats.recordedHighCents).toBe(1000);
    expect(stats.referencePricePercentile).toBeNull();
    expect(stats.shareNearReference).toBeNull();
  });

  it("computes reference stats when a reference price is present", () => {
    const observations: ScoringObservation[] = [];
    for (let i = 1; i <= 10; i++) {
      observations.push(obs(`2025-01-${String(i).padStart(2, "0")}`, 500, i === 10 ? 1000 : null));
    }
    const stats = computeStats(observations, new Date("2025-01-10T00:00:00Z"));
    expect(stats.referencePricePercentile).toBe(100); // all daily prices < 1000
    expect(stats.shareNearReference).toBe(0); // none >= 980
  });

  it("handles empty input", () => {
    const stats = computeStats([], new Date("2025-01-10T00:00:00Z"));
    expect(stats.observationCount).toBe(0);
    expect(stats.uniqueDays).toBe(0);
    expect(stats.coverageDays).toBe(0);
    expect(stats.medianAllCents).toBeNull();
    expect(stats.recordedLowCents).toBeNull();
    expect(stats.pricePercentile).toBeNull();
    expect(stats.newestObservedAt).toBeNull();
  });
});
