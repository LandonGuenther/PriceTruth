import { describe, expect, it } from "vitest";
import { OBSERVATION_SOURCES, retailerObservationSchema } from "./observation.js";

const valid = {
  retailer: "amazon",
  externalId: "B0ABC12345",
  url: "https://www.amazon.com/dp/B0ABC12345",
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

  it("enforces per-retailer externalId format and hostname", () => {
    expect(() => retailerObservationSchema.parse({ ...valid, externalId: "SHORT" })).toThrow();
    expect(() =>
      retailerObservationSchema.parse({
        ...valid,
        externalId: "123456",
        url: "https://www.bestbuy.com/p",
      }),
    ).toThrow(); // bestbuy URL on an amazon observation
    expect(() =>
      retailerObservationSchema.parse({ ...valid, url: "https://evil-amazon.com/dp/B0ABC12345" }),
    ).toThrow(); // hostname suffix trick
    expect(() =>
      retailerObservationSchema.parse({ ...valid, url: "https://smile.amazon.com/dp/B0ABC12345" }),
    ).not.toThrow();
  });

  it("enforces length/count bounds and Int32 price limits", () => {
    expect(() => retailerObservationSchema.parse({ ...valid, title: "x".repeat(1001) })).toThrow();
    expect(() =>
      retailerObservationSchema.parse({ ...valid, priceCents: 2_147_483_648 }),
    ).toThrow();
    expect(() =>
      retailerObservationSchema.parse({
        ...valid,
        variant: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])),
      }),
    ).toThrow();
    expect(() =>
      retailerObservationSchema.parse({ ...valid, variant: { ["k".repeat(65)]: "v" } }),
    ).toThrow();
    expect(() => retailerObservationSchema.parse({ ...valid, gtin: "12x4" })).toThrow();
    expect(() =>
      retailerObservationSchema.parse({ ...valid, extractorVersion: "v".repeat(33) }),
    ).toThrow();
  });

  it("requires referencePriceCents > priceCents", () => {
    expect(() =>
      retailerObservationSchema.parse({ ...valid, referencePriceCents: 29900 }),
    ).toThrow();
    expect(() =>
      retailerObservationSchema.parse({ ...valid, referencePriceCents: 20000 }),
    ).toThrow();
  });
});
