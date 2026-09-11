import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { amazonAdapter, AMAZON_ADAPTER_VERSION } from "./index.js";
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
    expect(r.meta.adapterVersion).toBe(AMAZON_ADAPTER_VERSION);
    expect(r.meta.identityMethod).toBe("url_asin");
    expect(r.meta.priceConfidence).toBe("HIGH");
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

  it("split whole/fraction price scoped to core container", () => {
    const doc = loadFixture("split-price.html");
    const r = amazonAdapter.extract(doc, productUrl("B0SPLITPRX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(19995);
    expect(r.meta.priceMethod).toBe("split_whole_fraction");
  });

  it("coupon badge amount is ignored", () => {
    const doc = loadFixture("coupon-present.html");
    const r = amazonAdapter.extract(doc, productUrl("B0COUPONXX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(4999);
  });

  it("conflicting buy-box prices → ambiguous_price", () => {
    const doc = loadFixture("multiple-visible-prices.html");
    const r = amazonAdapter.extract(doc, productUrl("B0MULTIVIS"), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous_price");
    expect(r.meta?.priceConfidence).toBe("AMBIGUOUS");
  });

  it("used offer price is rejected in favor of new buy box", () => {
    const doc = loadFixture("used-offer.html");
    const r = amazonAdapter.extract(doc, productUrl("B0USEDOFRX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(12999);
  });

  it("subscribe-and-save secondary price is ignored", () => {
    const doc = loadFixture("subscribe-and-save.html");
    const r = amazonAdapter.extract(doc, productUrl("B0SNSSECON"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(1899);
  });

  it("installment / APR text is not treated as cash price", () => {
    const doc = loadFixture("installment-text.html");
    const r = amazonAdapter.extract(doc, productUrl("B0INSTALLX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(59900);
  });

  it("cross-sell carousel prices never win", () => {
    const doc = loadFixture("cross-sell-carousel.html");
    const r = amazonAdapter.extract(doc, productUrl("B0CAROUSEL"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(34900);
    expect(r.observation.referencePriceCents).toBe(44900);
  });

  it("sponsored product rail prices never win", () => {
    const doc = loadFixture("sponsored-products.html");
    const r = amazonAdapter.extract(doc, productUrl("B0SPONSORD"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(8900);
    expect(r.observation.referencePriceCents).toBe(11900);
  });

  it("twister variant selection is captured", () => {
    const doc = loadFixture("twister-variant.html");
    const r = amazonAdapter.extract(doc, productUrl("B0TWISTERX"), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.priceCents).toBe(2750);
    expect(r.observation.variant).toEqual({ Color: "Navy", Size: "Medium" });
  });

  it("extractExternalId falls back to DOM when URL has no id", () => {
    const doc = loadFixture("sale-with-list-price.html");
    expect(amazonAdapter.extractExternalId(new URL("https://www.amazon.com/x"), doc)).toBe(
      "B0DEMOASIN",
    );
  });

  it("identity precedence: URL beats conflicting input#ASIN", () => {
    const doc = loadFixture("sale-with-list-price.html");
    const input = doc.querySelector<HTMLInputElement>("input#ASIN");
    if (input) input.value = "B0OTHERASI";
    expect(amazonAdapter.extractExternalId(productUrl("B0DEMOASIN"), doc)).toBe("B0DEMOASIN");
  });
});

describe("selector coverage", () => {
  const fixtures = readdirSync(fixtureDir).map((f) => loadFixture(f));
  const allSelectors = Object.values(AMAZON_SELECTORS).flatMap((v) => (Array.isArray(v) ? v : [v]));

  it.each(allSelectors)("selector %s matches a node in some fixture", (sel) => {
    const matched = fixtures.some((doc) => {
      return sel.split(",").some((part) => doc.querySelector(part.trim()) !== null);
    });
    expect(matched).toBe(true);
  });
});
