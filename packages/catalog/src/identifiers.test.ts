import { describe, expect, it } from "vitest";
import {
  detectCondition,
  gtinCheckDigitValid,
  mpnMatchKey,
  normalizeBrand,
  normalizeIdentifier,
} from "./identifiers.js";

describe("normalizeIdentifier", () => {
  it("normalizes GTIN-family values to 14 digits", () => {
    expect(normalizeIdentifier("UPC", "036000291452")).toEqual({
      normalized: "00036000291452",
      valid: true,
    });
    expect(normalizeIdentifier("EAN", "4006381333931").normalized).toBe("04006381333931");
    expect(normalizeIdentifier("GTIN", "00012345678905").valid).toBe(true);
  });

  it("rejects bad check digits and bad lengths", () => {
    expect(gtinCheckDigitValid("036000291452")).toBe(true);
    expect(gtinCheckDigitValid("036000291453")).toBe(false);
    const r = normalizeIdentifier("GTIN", "036000291453");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("gtin_bad_check_digit");
    expect(normalizeIdentifier("GTIN", "123").valid).toBe(false);
  });

  it("normalizes ASIN (upper, 10 alnum) and Best Buy SKU (digits)", () => {
    expect(normalizeIdentifier("ASIN", " b0abc12345 ").valid).toBe(true);
    expect(normalizeIdentifier("ASIN", "b0abc12345").normalized).toBe("B0ABC12345");
    expect(normalizeIdentifier("ASIN", "short").valid).toBe(false);
    expect(normalizeIdentifier("BESTBUY_SKU", "10129617").valid).toBe(true);
    expect(normalizeIdentifier("BESTBUY_SKU", "abc123").valid).toBe(false);
  });

  it("normalizes model numbers (upper, collapsed ws, separators kept)", () => {
    const r = normalizeIdentifier("MANUFACTURER_MODEL", "  wh-1000  xm6 ");
    expect(r).toEqual({ normalized: "WH-1000 XM6", valid: true });
    expect(normalizeIdentifier("MPN", "x").valid).toBe(false);
  });
});

describe("mpnMatchKey", () => {
  it("removes separators", () => {
    expect(mpnMatchKey("WH-1000XM6")).toBe("WH1000XM6");
    expect(mpnMatchKey("WH 1000 XM6")).toBe("WH1000XM6");
    expect(mpnMatchKey("WH_1000/XM6")).toBe("WH1000XM6");
    expect(mpnMatchKey("WH.1000XM6")).toBe("WH1000XM6");
  });
});

describe("normalizeBrand", () => {
  it("lowercases, collapses whitespace, drops corporate suffixes", () => {
    expect(normalizeBrand("  Sony  ")).toBe("sony");
    expect(normalizeBrand("Sony Inc.")).toBe("sony");
    expect(normalizeBrand("Acme LLC")).toBe("acme");
    expect(normalizeBrand("LTD Co")).toBe("ltd co");
  });
});

describe("detectCondition", () => {
  it("detects refurbished/used tokens, else UNKNOWN", () => {
    expect(detectCondition("Sony WH-1000XM5 (Renewed)")).toBe("REFURBISHED");
    expect(detectCondition("Refurbished widget")).toBe("REFURBISHED");
    expect(detectCondition("Pre-Owned Console")).toBe("USED");
    expect(detectCondition("Open-Box TV")).toBe("USED");
    expect(detectCondition("Sony WH-1000XM6")).toBe("UNKNOWN");
  });
});
