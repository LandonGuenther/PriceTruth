import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { findAdapter } from "../index.js";
import { bestbuyAdapter } from "./index.js";
import { BESTBUY_SELECTORS } from "./selectors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "../../fixtures/bestbuy");

function loadFixture(name: string): Document {
  const html = readFileSync(path.join(fixtureDir, name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

const NOW = new Date("2025-06-30T12:00:00.000Z");
const pdp = (sku: string) => new URL(`https://www.bestbuy.com/site/acme-tv/${sku}.p?skuId=${sku}`);

describe("matchesUrl", () => {
  it.each([
    ["https://www.bestbuy.com/site/acme-tv/6418599.p?skuId=6418599", true],
    ["https://www.bestbuy.com/site/acme-tv/6418599.p", true],
    ["https://www.bestbuy.com/site/searchpage?skuId=6418599", true],
    ["https://www.bestbuy.com/site/tvs/abc.pcmcat", false],
    ["https://www.bestbuy.com/", false],
    ["https://www.amazon.com/dp/B0DEMOASIN", false],
  ])("%s → %s", (u, expected) => {
    expect(bestbuyAdapter.matchesUrl(new URL(u))).toBe(expected);
  });
});

describe("extract", () => {
  it("JSON-LD + Was price", () => {
    const doc = loadFixture("jsonld-with-was-price.html");
    const url = pdp("6418599");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation).toMatchObject({
      retailer: "bestbuy",
      externalId: "6418599",
      url: url.href,
      title: 'Acme 55" 4K TV',
      brand: "Acme",
      modelNumber: "AC55-4K",
      gtin: "0012345678905",
      priceCents: 27999,
      referencePriceCents: 39999,
      currency: "USD",
      inStock: true,
      source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
      observedAt: NOW.toISOString(),
    });
  });

  it("JSON-LD without reference → referencePriceCents undefined", () => {
    const doc = loadFixture("jsonld-no-reference.html");
    const r = bestbuyAdapter.extract(doc, pdp("6532187"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(4999);
    expect(r.observation.referencePriceCents).toBeUndefined();
    expect(r.observation.brand).toBe("Acme");
    expect(r.observation.modelNumber).toBe("AC-T2");
  });

  it("DOM-only price fallback without JSON-LD", () => {
    const doc = loadFixture("dom-only-price.html");
    const r = bestbuyAdapter.extract(doc, pdp("6401234"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(8999);
    expect(r.observation.referencePriceCents).toBe(11999);
    expect(r.observation.title).toBe("Acme Blender");
  });

  it("sold out → inStock false but extraction still ok", () => {
    const doc = loadFixture("sold-out.html");
    const r = bestbuyAdapter.extract(doc, pdp("6509655"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(49999);
    expect(r.observation.inStock).toBe(false);
  });

  it("skuId only in query string", () => {
    const doc = loadFixture("jsonld-with-was-price.html");
    const url = new URL("https://www.bestbuy.com/site/acme?skuId=6418599");
    expect(bestbuyAdapter.matchesUrl(url)).toBe(true);
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.externalId).toBe("6418599");
  });

  it("extractExternalId falls back to data-sku-id / spec table", () => {
    const doc = loadFixture("dom-only-price.html");
    const plain = new URL("https://www.bestbuy.com/site/anything");
    expect(bestbuyAdapter.extractExternalId(plain, doc)).toBe("6401234");
  });
});

describe("findAdapter", () => {
  it("routes URLs to the right adapter", () => {
    expect(findAdapter(new URL("https://www.amazon.com/dp/B0DEMOASIN"))?.retailer).toBe("amazon");
    expect(findAdapter(pdp("6418599"))?.retailer).toBe("bestbuy");
    expect(findAdapter(new URL("https://www.example.com/"))).toBeNull();
    expect(findAdapter(new URL("https://www.bestbuy.com/site/tvs/abc.pcmcat"))).toBeNull();
    expect(findAdapter(new URL("https://www.amazon.com/s?k=widget"))).toBeNull();
  });
});

describe("selector coverage", () => {
  const fixtures = readdirSync(fixtureDir).map((f) => loadFixture(f));
  const allSelectors = Object.values(BESTBUY_SELECTORS).flatMap((v) =>
    Array.isArray(v) ? v : [v],
  );

  it.each(allSelectors)("selector %s matches a node in some fixture", (sel) => {
    const matched = fixtures.some((doc) =>
      sel.split(",").some((part) => doc.querySelector(part.trim()) !== null),
    );
    expect(matched).toBe(true);
  });
});
