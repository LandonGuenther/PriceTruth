import { describe, expect, it } from "vitest";
import { resolveObservationTime } from "../src/services/timePolicy.js";

const NOW = new Date("2025-06-30T12:00:00Z");

describe("resolveObservationTime", () => {
  it("CLIENT_REPORTED: effectiveAt is receipt time, skew recorded", () => {
    const client = new Date(NOW.getTime() - 5 * 60_000);
    const r = resolveObservationTime({
      trustClass: "CLIENT_REPORTED",
      clientObservedAt: client,
      receivedAt: NOW,
    });
    expect(r.effectiveAt).toBe(NOW);
    expect(r.clientSkewSeconds).toBe(-300);
    expect(r.rejectReason).toBeUndefined();
  });

  it("CLIENT_REPORTED: >10min future → reject", () => {
    const r = resolveObservationTime({
      trustClass: "CLIENT_REPORTED",
      clientObservedAt: new Date(NOW.getTime() + 11 * 60_000),
      receivedAt: NOW,
    });
    expect(r.rejectReason).toMatch(/future/);
  });

  it("CLIENT_REPORTED: >7d old → reject", () => {
    const r = resolveObservationTime({
      trustClass: "CLIENT_REPORTED",
      clientObservedAt: new Date(NOW.getTime() - 8 * 86_400_000),
      receivedAt: NOW,
    });
    expect(r.rejectReason).toMatch(/7 days/);
  });

  it("CLIENT_REPORTED: missing clientObservedAt → effectiveAt = receivedAt, skew null", () => {
    const r = resolveObservationTime({
      trustClass: "CLIENT_REPORTED",
      clientObservedAt: null,
      receivedAt: NOW,
    });
    expect(r.effectiveAt).toBe(NOW);
    expect(r.clientSkewSeconds).toBeNull();
  });

  it.each(["SERVER_FETCHED", "VERIFIED", "TEST"] as const)(
    "%s: effectiveAt is the reported time",
    (trustClass) => {
      const reported = new Date(NOW.getTime() - 86_400_000);
      const r = resolveObservationTime({
        trustClass,
        clientObservedAt: reported,
        receivedAt: NOW,
      });
      expect(r.effectiveAt).toBe(reported);
      expect(r.clientSkewSeconds).toBeNull();
      expect(r.rejectReason).toBeUndefined();
    },
  );

  it("trusted source without a reported time falls back to receivedAt", () => {
    const r = resolveObservationTime({
      trustClass: "SERVER_FETCHED",
      clientObservedAt: null,
      receivedAt: NOW,
    });
    expect(r.effectiveAt).toBe(NOW);
  });
});
