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
    [
      "https://www.bestbuy.com/product/apple-airpods-pro-2-wireless-active-noise-cancelling-earbuds-with-hearing-aid-feature-white/JJGCQ88C8X",
      true,
    ],
    ["https://www.bestbuy.com/product/some-category-landing", false],
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
      schemaVersion: 1,
      priceType: "STANDARD",
      referenceType: "UNKNOWN",
      extractorVersion: "1.2.1",
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

  it("new-format /product/ URL: identity and price from JSON-LD + DOM", () => {
    const doc = loadFixture("product-new-url-marketplace.html");
    const url = new URL(
      "https://www.bestbuy.com/product/apple-airpods-pro-2-wireless-active-noise-cancelling-earbuds-with-hearing-aid-feature-white/JJGCQ88C8X",
    );
    expect(bestbuyAdapter.matchesUrl(url)).toBe(true);
    expect(bestbuyAdapter.extractExternalId(url, doc)).toBe("10129617");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation).toMatchObject({
      externalId: "10129617",
      brand: "Apple",
      modelNumber: "MTJV3LL/A/MTJV3AM/A",
      priceCents: 23899,
      referencePriceCents: 27499,
      inStock: true,
    });
  });

  it("new-format URL without JSON-LD: sku/price/reference via DOM", () => {
    const doc = loadFixture("product-new-url-no-jsonld.html");
    const url = new URL("https://www.bestbuy.com/product/some-slug/JJGCQ88C8X");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.externalId).toBe("10129617");
    expect(r.observation.priceCents).toBe(23899);
    expect(r.observation.referencePriceCents).toBe(27499);
    expect(r.observation.inStock).toBe(true);
  });

  it("/product/<slug>/<code>/sku/<id> URLs match and carry a URL sku", () => {
    const url = new URL(
      "https://www.bestbuy.com/product/shokz-openfit-pro-earbuds-black/J3GWRW4HCC/sku/6665563",
    );
    expect(bestbuyAdapter.matchesUrl(url)).toBe(true);
    const bare = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    expect(bestbuyAdapter.extractExternalId(url, bare)).toBe("6665563");
  });

  it("reviews sub-page: URL sku + still-rendered price block extract fine", () => {
    const doc = loadFixture("product-new-url-reviews.html");
    const url = new URL(
      "https://www.bestbuy.com/product/airpods-pro-2/JJGCQ88C8X/sku/10129617/reviews",
    );
    expect(bestbuyAdapter.matchesUrl(url)).toBe(true);
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.externalId).toBe("10129617");
    expect(r.observation.priceCents).toBe(23899);
    expect(r.observation.referencePriceCents).toBe(27499);
  });

  it("cross-sell/carousel price blocks never leak into price or reference", () => {
    const doc = loadFixture("product-new-url-crosssell.html");
    const r = bestbuyAdapter.extract(
      doc,
      new URL("https://www.bestbuy.com/product/beats-studio-pro/JJ8ZHR9K2T/sku/6501017"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.externalId).toBe("6501017");
    expect(r.observation.priceCents).toBe(24999);
    expect(r.observation.referencePriceCents).toBe(29999);
  });

  it("only-contaminated 'was' text → referencePriceCents undefined", () => {
    const doc = loadFixture("product-new-url-crosssell.html");
    doc
      .querySelector('[data-testid="LARGE_profile"] [data-testid="price-block-regular-price"]')
      ?.remove();
    const r = bestbuyAdapter.extract(
      doc,
      new URL("https://www.bestbuy.com/product/beats-studio-pro/JJ8ZHR9K2T/sku/6501017"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(24999);
    expect(r.observation.referencePriceCents).toBeUndefined();
  });

  it("legacy URL sku vs page sku mismatch → page wins, warning emitted", () => {
    const doc = loadFixture("product-new-url-marketplace.html");
    const url = new URL("https://www.bestbuy.com/site/airpods/6447382.p?skuId=6447382");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.externalId).toBe("10129617");
    expect(r.warnings).toContain("url sku differs from page sku");
  });

  it("extractExternalId falls back to data-sku-id / spec table", () => {
    const doc = loadFixture("dom-only-price.html");
    const plain = new URL("https://www.bestbuy.com/site/anything");
    expect(bestbuyAdapter.extractExternalId(plain, doc)).toBe("6401234");
  });

  it("Comp. Value DOM-only: customer price + reference", () => {
    const doc = loadFixture("comp-value-dom-only.html");
    const url = new URL("https://www.bestbuy.com/product/acme-soundbar/JJCOMPVAL1");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.externalId).toBe("6578901");
    expect(r.observation.priceCents).toBe(14999);
    expect(r.observation.referencePriceCents).toBe(19999);
  });

  it("financing/month-only customer price → no_price", () => {
    const doc = loadFixture("financing-month.html");
    const url = new URL("https://www.bestbuy.com/product/acme-tv/JJFINANCE01");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_price");
    expect(r.warnings).toContain("financing/month price ignored");
  });

  it("open-box tile ignored; new cash price wins", () => {
    const doc = loadFixture("open-box.html");
    const url = new URL("https://www.bestbuy.com/product/acme-headphones/JJOPENBOX01");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(12999);
    expect(r.observation.referencePriceCents).toBe(15999);
  });

  it("bundle upsell tile ignored; product price wins", () => {
    const doc = loadFixture("bundle-upsell.html");
    const url = new URL("https://www.bestbuy.com/product/acme-camera/JJBUNDLE001");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(89999);
  });

  it("JSON-LD vs DOM customer price conflict → ambiguous_price", () => {
    const doc = loadFixture("jsonld-dom-price-conflict.html");
    const url = new URL("https://www.bestbuy.com/product/acme-conflict/JJCONFLICT1");
    const r = bestbuyAdapter.extract(doc, url, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous_price");
    expect(r.warnings).toContain("JSON-LD price conflicts with DOM price");
  });

  it("legacy marketplace listing: Comp. Value as reference", () => {
    const doc = loadFixture("marketplace-legacy.html");
    const r = bestbuyAdapter.extract(doc, pdp("6445001"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(5999);
    expect(r.observation.referencePriceCents).toBe(7999);
    expect(r.observation.externalId).toBe("6445001");
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
