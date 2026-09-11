import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { amazonAdapter } from "./index.js";
import { AMAZON_SELECTORS } from "./selectors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "../../fixtures/amazon");

function loadFixture(name: string): Document {
  const html = readFileSync(path.join(fixtureDir, name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

const NOW = new Date("2025-06-30T12:00:00.000Z");
const productUrl = (asin: string, style: "dp" | "gp" | "aw" = "dp") =>
  new URL(
    style === "dp"
      ? `https://www.amazon.com/Acme-Widget/dp/${asin}`
      : style === "gp"
        ? `https://www.amazon.com/gp/product/${asin}`
        : `https://www.amazon.com/gp/aw/d/${asin}`,
  );

describe("matchesUrl", () => {
  it.each([
    ["https://www.amazon.com/Acme-Widget/dp/B0DEMOASIN", true],
    ["https://www.amazon.com/dp/B0DEMOASIN?th=1", true],
    ["https://www.amazon.com/gp/product/B0DEMOASIN", true],
    ["https://www.amazon.com/gp/aw/d/B0DEMOASIN", true],
    ["https://www.amazon.com/s?k=widget", false],
    ["https://smile.amazon.com/dp/B0DEMOASIN", true],
    ["https://www.amazon.co.uk/dp/B0DEMOASIN", false],
    ["https://www.bestbuy.com/site/x/6418599.p", false],
  ])("%s → %s", (u, expected) => {
    expect(amazonAdapter.matchesUrl(new URL(u))).toBe(expected);
  });
});

describe("extract", () => {
  it("sale with List Price", () => {
    const doc = loadFixture("sale-with-list-price.html");
    const url = productUrl("B0DEMOASIN");
    const r = amazonAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation).toMatchObject({
      retailer: "amazon",
      externalId: "B0DEMOASIN",
      url: url.href,
      title: "Acme Demo Widget 3000",
      brand: "Acme",
      modelNumber: "Widget 3000",
      priceCents: 29900,
      referencePriceCents: 49900,
      currency: "USD",
      inStock: true,
      source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
      observedAt: NOW.toISOString(),
    });
    expect(r.observation.variant).toEqual({ Size: "Large" });
  });

  it("no reference price → referencePriceCents undefined", () => {
    const doc = loadFixture("no-reference.html");
    const r = amazonAdapter.extract(doc, productUrl("B0NOREFPRX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(1299);
    expect(r.observation.referencePriceCents).toBeUndefined();
    expect(r.observation.brand).toBe("Acme");
  });

  it("Typical price basis captured as reference", () => {
    const doc = loadFixture("typical-price.html");
    const r = amazonAdapter.extract(doc, productUrl("B0TYPICALX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(4499);
    expect(r.observation.referencePriceCents).toBe(5999);
    expect(r.observation.inStock).toBe(true);
  });

  it("legacy priceblock_ourprice with struck-through reference", () => {
    const doc = loadFixture("legacy-priceblock.html");
    const r = amazonAdapter.extract(doc, productUrl("B0LEGACYPR"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(2499);
    expect(r.observation.referencePriceCents).toBe(3999);
  });

  it("out of stock page without price → no_price", () => {
    const doc = loadFixture("out-of-stock-no-price.html");
    const r = amazonAdapter.extract(doc, productUrl("B0NOSTOCKX"), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_price");
  });

  it("split whole/fraction price", () => {
    const doc = loadFixture("split-price.html");
    const r = amazonAdapter.extract(doc, productUrl("B0SPLITPRX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(19995);
  });

  it("extractExternalId falls back to DOM when URL has no id", () => {
    const doc = loadFixture("sale-with-list-price.html");
    expect(amazonAdapter.extractExternalId(new URL("https://www.amazon.com/x"), doc)).toBe(
      "B0DEMOASIN",
    );
  });
});

describe("selector coverage", () => {
  const fixtures = readdirSync(fixtureDir).map((f) => loadFixture(f));
  const allSelectors = Object.values(AMAZON_SELECTORS).flatMap((v) => (Array.isArray(v) ? v : [v]));

  it.each(allSelectors)("selector %s matches a node in some fixture", (sel) => {
    const matched = fixtures.some((doc) => {
      // Compound selectors like "a, b" need per-part evaluation for coverage.
      return sel.split(",").some((part) => doc.querySelector(part.trim()) !== null);
    });
    expect(matched).toBe(true);
  });
});
