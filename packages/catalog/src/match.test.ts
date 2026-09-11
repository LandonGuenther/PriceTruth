import { describe, expect, it } from "vitest";
import { evaluateMatch, shouldAutoLink, type ExistingProduct } from "./match.js";
import { normalizeIdentifier, type NormalizedIdentifier } from "./identifiers.js";

const id = (t: string, raw: string): NormalizedIdentifier => {
  const r = normalizeIdentifier(t as NormalizedIdentifier["type"], raw);
  return { type: t as NormalizedIdentifier["type"], value: r.normalized, valid: r.valid };
};

const product = (
  productId: string,
  ids: NormalizedIdentifier[],
  brand?: string,
  title = "Widget",
): ExistingProduct => ({ productId, identifiers: ids, brand, title });

describe("evaluateMatch", () => {
  it("same valid UPC on Amazon + Best Buy listings → EXACT", () => {
    const existing = product("p1", [id("GTIN", "036000291452")], "Sony");
    const d = evaluateMatch(
      { identifiers: [id("GTIN", "036000291452")], brand: "Sony", title: "Headphones" },
      [existing],
    );
    expect(d.level).toBe("EXACT");
    expect(d.productId).toBe("p1");
    expect(d.reasons).toContain("gtin_exact:00036000291452");
    expect(shouldAutoLink(d.level)).toBe(true);
  });

  it("different MPN, same brand (128GB vs 256GB) → UNRESOLVED", () => {
    const existing = product("p1", [id("MPN", "WIDGET-128GB")], "Acme");
    const d = evaluateMatch(
      {
        identifiers: [id("MPN", "WIDGET-256GB")],
        brand: "Acme",
        title: "Acme Widget 256GB",
      },
      [existing],
    );
    expect(d.level).toBe("UNRESOLVED");
    expect(d.productId).toBeNull();
  });

  it("same GTIN but NEW vs REFURBISHED → not linked (condition_mismatch)", () => {
    const existing = product(
      "p1",
      [id("GTIN", "036000291452")],
      "Sony",
      "Sony Headphones (Renewed)",
    );
    const d = evaluateMatch(
      { identifiers: [id("GTIN", "036000291452")], brand: "Sony", title: "New Sony Headphones" },
      [existing],
    );
    expect(d.productId).toBeNull();
    expect(d.reasons).toContain("condition_mismatch");
    expect(shouldAutoLink(d.level)).toBe(false);
  });

  it("different generations (gen1 vs gen2 models) → UNRESOLVED", () => {
    const existing = product("p1", [id("MANUFACTURER_MODEL", "WH-1000XM5")], "Sony");
    const d = evaluateMatch(
      {
        identifiers: [id("MANUFACTURER_MODEL", "WH-1000XM6")],
        brand: "Sony",
        title: "Headphones",
      },
      [existing],
    );
    expect(d.level).toBe("UNRESOLVED");
  });

  it("MPN formatting variants with same brand → HIGH", () => {
    const existing = product("p1", [id("MPN", "WH-1000XM6")], "Sony Inc.");
    const d = evaluateMatch(
      {
        identifiers: [id("MANUFACTURER_MODEL", "wh 1000 xm6")],
        brand: "Sony",
        title: "Headphones",
      },
      [existing],
    );
    expect(d.level).toBe("HIGH");
    expect(d.productId).toBe("p1");
    expect(shouldAutoLink(d.level)).toBe(true);
  });

  it("bad-checksum UPC equal → valid=false, REVIEW only", () => {
    const bad = id("GTIN", "036000291453"); // checksum fails
    expect(bad.valid).toBe(false);
    const existing = product("p1", [id("GTIN", "036000291453")]);
    const d = evaluateMatch({ identifiers: [bad], title: "W" }, [existing]);
    expect(d.level).toBe("REVIEW");
    expect(d.productId).toBeNull();
    expect(d.reasons).toContain("gtin_invalid:00036000291453");
  });

  it("GTIN → product A, brand+model → product B → CONFLICT", () => {
    const a = product("pA", [id("GTIN", "036000291452")], "Sony");
    const b = product("pB", [id("MANUFACTURER_MODEL", "WH-1000XM6")], "Sony");
    const d = evaluateMatch(
      {
        identifiers: [id("GTIN", "036000291452"), id("MANUFACTURER_MODEL", "WH-1000XM6")],
        brand: "Sony",
        title: "Headphones",
      },
      [a, b],
    );
    expect(d.level).toBe("CONFLICT");
    expect(d.productId).toBeNull();
    expect(d.reasons).toContain("gtin_exact:00036000291452");
    expect(d.reasons).toContain("brand_model_exact:WH1000XM6");
  });

  it("model match without brand → REVIEW (model_only)", () => {
    const existing = product("p1", [id("MPN", "WH-1000XM6")], "Bose");
    const d = evaluateMatch({ identifiers: [id("MPN", "WH-1000XM6")], brand: "Sony", title: "H" }, [
      existing,
    ]);
    expect(d.level).toBe("REVIEW");
    expect(d.reasons).toContain("model_only:WH1000XM6");
  });

  it("no identifiers → UNRESOLVED; identical titles never link", () => {
    const existing = product("p1", [id("GTIN", "036000291452")], "Sony", "Sony Headphones");
    expect(evaluateMatch({ identifiers: [], title: "X" }, [existing]).level).toBe("UNRESOLVED");
    const d = evaluateMatch({ identifiers: [], title: "Sony Headphones" }, [existing]);
    expect(d.level).toBe("UNRESOLVED");
    expect(d.productId).toBeNull();
  });
});
