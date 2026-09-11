import { describe, expect, it } from "vitest";
import { formatCents, parsePriceToCents } from "./money.js";

describe("parsePriceToCents", () => {
  it("parses dollar prices with thousands separators", () => {
    expect(parsePriceToCents("$1,299.99")).toBe(129999);
    expect(parsePriceToCents("$1,299.")).toBe(129900);
  });

  it("parses plain numbers and whole dollars", () => {
    expect(parsePriceToCents("1299.99")).toBe(129999);
    expect(parsePriceToCents("$299")).toBe(29900);
    expect(parsePriceToCents("0.99")).toBe(99);
  });

  it("handles whitespace and non-breaking spaces", () => {
    expect(parsePriceToCents("  $1,299.99  ")).toBe(129999);
    expect(parsePriceToCents("$ 1,299.99")).toBe(129999);
    expect(parsePriceToCents("\t$42.50\n")).toBe(4250);
  });

  it("handles other currency symbols", () => {
    expect(parsePriceToCents("€1.299,99", "EUR")).toBeNull(); // European format unsupported
    expect(parsePriceToCents("£49.99", "GBP")).toBe(4999);
  });

  it("returns null for empty, invalid, or negative input", () => {
    expect(parsePriceToCents("")).toBeNull();
    expect(parsePriceToCents("   ")).toBeNull();
    expect(parsePriceToCents("$")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNull();
    expect(parsePriceToCents("-5.00")).toBeNull();
    expect(parsePriceToCents("$-5.00")).toBeNull();
    expect(parsePriceToCents("12.999")).toBeNull();
    expect(parsePriceToCents("1.2.3")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats cents as USD", () => {
    expect(formatCents(129999)).toBe("$1,299.99");
    expect(formatCents(29900)).toBe("$299.00");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats other currencies", () => {
    expect(formatCents(4999, "GBP")).toBe("£49.99");
  });
});
