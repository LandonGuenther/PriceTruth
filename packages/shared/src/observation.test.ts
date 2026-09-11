import { describe, expect, it } from "vitest";
import { OBSERVATION_SOURCES, retailerObservationSchema } from "./observation.js";

const valid = {
  retailer: "amazon",
  externalId: "B0ABC123",
  url: "https://www.amazon.com/dp/B0ABC123",
  title: "Example product",
  priceCents: 29900,
  referencePriceCents: 49900,
  currency: "USD",
  source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
  observedAt: "2025-01-15T12:00:00.000Z",
  schemaVersion: 1,
  priceType: "STANDARD",
  referenceType: "UNKNOWN",
};

describe("retailerObservationSchema", () => {
  it("accepts a valid observation", () => {
    expect(retailerObservationSchema.parse(valid)).toMatchObject({ priceCents: 29900 });
  });

  it("rejects non-positive prices", () => {
    expect(() => retailerObservationSchema.parse({ ...valid, priceCents: 0 })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, priceCents: -5 })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, referencePriceCents: -1 })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, priceCents: 1.5 })).toThrow();
  });

  it("rejects bad currency, url, externalId, source, observedAt", () => {
    expect(() => retailerObservationSchema.parse({ ...valid, currency: "usd" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, currency: "US" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, url: "ftp://x" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, url: "not a url" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, externalId: "  " })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, source: "" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, observedAt: "yesterday" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, schemaVersion: 2 })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, priceType: "NOPE" })).toThrow();
  });

  it("requires referenceType iff referencePriceCents is present", () => {
    const noRef: Record<string, unknown> = { ...valid };
    delete noRef.referencePriceCents;
    delete noRef.referenceType;
    expect(() => retailerObservationSchema.parse({ ...noRef, referenceType: "UNKNOWN" })).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, referenceType: undefined })).toThrow();
    expect(retailerObservationSchema.parse(noRef).priceCents).toBe(29900);
  });
});
