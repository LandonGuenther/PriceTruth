import { describe, expect, it } from "vitest";
import { collapseToDailySeries } from "./daily.js";
import type { ScoringObservation } from "./types.js";

const obs = (day: string, priceCents: number, time = "T12:00:00Z"): ScoringObservation => ({
  priceCents,
  referencePriceCents: null,
  effectiveAt: `${day}${time}`,
  sourceKey: "test",
});

describe("collapseToDailySeries", () => {
  it("collapses multiple same-day observations to the median (odd count)", () => {
    const daily = collapseToDailySeries([
      obs("2025-01-10", 100),
      obs("2025-01-10", 300, "T13:00:00Z"),
      obs("2025-01-10", 200, "T14:00:00Z"),
    ]);
    expect(daily).toEqual([{ day: "2025-01-10", medianPriceCents: 200 }]);
  });

  it("averages the two middle values for even counts", () => {
    const daily = collapseToDailySeries([
      obs("2025-01-10", 100),
      obs("2025-01-10", 200, "T01:00:00Z"),
      obs("2025-01-10", 300, "T02:00:00Z"),
      obs("2025-01-10", 401, "T03:00:00Z"),
    ]);
    expect(daily).toEqual([{ day: "2025-01-10", medianPriceCents: 250 }]);
  });

  it("groups by UTC day and sorts ascending", () => {
    const daily = collapseToDailySeries([
      obs("2025-01-12", 300),
      obs("2025-01-10", 100),
      obs("2025-01-11", 200),
      // 2025-01-11T23:30:00-05:00 is 2025-01-12 in UTC.
      {
        priceCents: 500,
        referencePriceCents: null,
        effectiveAt: "2025-01-11T23:30:00-05:00",
        sourceKey: "test",
      },
    ]);
    expect(daily.map((p) => p.day)).toEqual(["2025-01-10", "2025-01-11", "2025-01-12"]);
    expect(daily[2]?.medianPriceCents).toBe(400); // median(300, 500)
  });

  it("a single wild outlier observation cannot move the daily median", () => {
    const observations: ScoringObservation[] = [];
    for (let i = 0; i < 10; i++) {
      observations.push(obs(`2025-02-${String(i + 1).padStart(2, "0")}`, 30000));
    }
    // One day gets two normal observations plus one wild outlier.
    observations.push(obs("2025-02-05", 30000, "T01:00:00Z"));
    observations.push(obs("2025-02-05", 30000, "T02:00:00Z"));
    observations.push(obs("2025-02-05", 1000, "T03:00:00Z"));

    const daily = collapseToDailySeries(observations);
    expect(daily.find((p) => p.day === "2025-02-05")?.medianPriceCents).toBe(30000);
    expect(daily.every((p) => p.medianPriceCents === 30000)).toBe(true);
  });
});
