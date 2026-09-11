import { describe, expect, it } from "vitest";
import { analyzeListing } from "./analyze.js";
import { dealScoreLabel } from "./dealScore.js";
import { discountIntegrityLabel } from "./discountIntegrity.js";
import type { ScoringObservation } from "./types.js";

/**
 * Worked example from the product brief / docs/SCORING.md:
 * a 180-day daily history where the last 90 days median to $319, the recorded
 * low is $259 and the recorded high is $349; current price $299 with an
 * advertised $499 reference.
 *
 * Construction: days 0..179 before asOf. The newest day carries the current
 * price ($299); the other 89 days of the 90d window are $319 (median90=31900).
 * The older 90 days are $329 except two extremes $259 and $349.
 */
const AS_OF = new Date("2025-06-30T12:00:00Z");

export function workedExampleObservations(): ScoringObservation[] {
  const observations: ScoringObservation[] = [];
  for (let i = 179; i >= 1; i--) {
    const d = new Date(AS_OF.getTime() - i * 86_400_000);
    let priceCents = 32900;
    if (i <= 89) priceCents = 31900; // last 90 days (excluding today)
    if (i === 179) priceCents = 25900; // recorded low
    if (i === 178) priceCents = 34900; // recorded high
    observations.push({
      priceCents,
      referencePriceCents: null,
      effectiveAt: d.toISOString(),
      sourceKey: "test",
    });
  }
  observations.push({
    priceCents: 29900,
    referencePriceCents: 49900,
    effectiveAt: AS_OF.toISOString(),
    sourceKey: "test",
  });
  return observations;
}

describe("worked example", () => {
  const result = analyzeListing({ observations: workedExampleObservations(), asOf: AS_OF });

  it("produces the pinned stats", () => {
    expect(result.stats.observationCount).toBe(180);
    expect(result.stats.uniqueDays).toBe(180);
    expect(result.stats.coverageDays).toBe(180);
    expect(result.stats.median90Cents).toBe(31900);
    expect(result.stats.medianAllCents).toBe(31900);
    expect(result.stats.recordedLowCents).toBe(25900);
    expect(result.stats.recordedHighCents).toBe(34900);
    expect(result.stats.pricePercentile).toBe(0.6); // only the $259 day is below $299
    expect(result.stats.shareAtOrBelowCurrent).toBe(1.1); // $259 day + the $299 day itself
    expect(result.stats.referencePricePercentile).toBe(100);
    expect(result.stats.shareNearReference).toBe(0);
    expect(result.confidence.level).toBe("HIGH");
    expect(result.typical).toEqual({ cents: 31900, window: "90d" });
  });

  it("pins the exact scores", () => {
    expect(result.discountIntegrity.advertisedDiscountPct).toBe(40.1);
    expect(result.discountIntegrity.actualDiscountVsTypicalPct).toBe(6.3);
    expect(result.discountIntegrity.score).toBe(9);
    expect(result.discountIntegrity.label).toBe(
      "Reference price not supported by our observations",
    );
    expect(result.dealScore.score).toBe(78);
    expect(result.dealScore.label).toBe("Better than typical");
  });

  it("matches the brief's expectations", () => {
    expect(result.discountIntegrity.score ?? 100).toBeLessThan(40);
    expect(result.dealScore.score ?? 0).toBeGreaterThanOrEqual(60);
  });
});

describe("discount integrity edge cases", () => {
  it("no reference price → score null, No advertised discount", () => {
    const obs = workedExampleObservations().map((o) => ({ ...o, referencePriceCents: null }));
    const result = analyzeListing({ observations: obs, asOf: AS_OF });
    expect(result.discountIntegrity.score).toBeNull();
    expect(result.discountIntegrity.label).toBe("No advertised discount");
    expect(result.discountIntegrity.advertisedDiscountPct).toBeNull();
  });

  it("reference <= current → score null, No advertised discount", () => {
    const obs = workedExampleObservations();
    obs[obs.length - 1] = { ...obs[obs.length - 1]!, referencePriceCents: 29900 };
    const result = analyzeListing({ observations: obs, asOf: AS_OF });
    expect(result.discountIntegrity.score).toBeNull();
    expect(result.discountIntegrity.label).toBe("No advertised discount");
  });

  it("insufficient history still reports the advertised markdown", () => {
    const obs: ScoringObservation[] = [
      {
        priceCents: 24000,
        referencePriceCents: null,
        effectiveAt: "2025-06-29T12:00:00.000Z",
        sourceKey: "test",
      },
      {
        priceCents: 23899,
        referencePriceCents: 27499,
        effectiveAt: AS_OF.toISOString(),
        sourceKey: "test",
      },
    ];
    const result = analyzeListing({ observations: obs, asOf: AS_OF });
    expect(result.confidence.level).toBe("INSUFFICIENT");
    expect(result.discountIntegrity.score).toBeNull();
    expect(result.discountIntegrity.advertisedDiscountPct).toBe(13.1);
    expect(result.discountIntegrity.actualDiscountVsTypicalPct).toBeNull();
  });

  it("insufficient history without a reference → advertisedDiscountPct null", () => {
    const obs: ScoringObservation[] = [
      {
        priceCents: 23899,
        referencePriceCents: null,
        effectiveAt: AS_OF.toISOString(),
        sourceKey: "test",
      },
    ];
    const result = analyzeListing({ observations: obs, asOf: AS_OF });
    expect(result.confidence.level).toBe("INSUFFICIENT");
    expect(result.discountIntegrity.advertisedDiscountPct).toBeNull();
  });
});

describe("score labels", () => {
  it("deal score boundaries", () => {
    expect(dealScoreLabel(80)).toBe("Historically strong price");
    expect(dealScoreLabel(79)).toBe("Better than typical");
    expect(dealScoreLabel(60)).toBe("Better than typical");
    expect(dealScoreLabel(59)).toBe("Typical price");
    expect(dealScoreLabel(40)).toBe("Typical price");
    expect(dealScoreLabel(39)).toBe("Above typical");
    expect(dealScoreLabel(20)).toBe("Above typical");
    expect(dealScoreLabel(19)).toBe("Historically expensive price");
  });

  it("discount integrity boundaries", () => {
    expect(discountIntegrityLabel(70)).toBe("Strong historical support");
    expect(discountIntegrityLabel(69)).toBe("Moderate historical support");
    expect(discountIntegrityLabel(40)).toBe("Moderate historical support");
    expect(discountIntegrityLabel(39)).toBe("Weak historical support");
    expect(discountIntegrityLabel(20)).toBe("Weak historical support");
    expect(discountIntegrityLabel(19)).toBe("Reference price not supported by our observations");
  });
});

describe("explanation language", () => {
  const FORBIDDEN = [/scam/i, /fraud/i, /fake/i, /illegal/i, /deceptive/i, /all-time low/i];

  it("reasons never use forbidden words or 'all-time low'", () => {
    const scenarios = [
      analyzeListing({ observations: workedExampleObservations(), asOf: AS_OF }),
      analyzeListing({ observations: [], asOf: AS_OF }),
      analyzeListing({
        observations: workedExampleObservations().map((o) => ({
          ...o,
          referencePriceCents: null,
        })),
        asOf: AS_OF,
      }),
    ];
    for (const r of scenarios) {
      const allReasons = [
        ...r.confidence.reasons,
        ...r.dealScore.reasons,
        ...r.discountIntegrity.reasons,
      ];
      expect(allReasons.length).toBeGreaterThan(0);
      for (const reason of allReasons) {
        for (const word of FORBIDDEN) {
          expect(reason).not.toMatch(word);
        }
      }
    }
  });
});
