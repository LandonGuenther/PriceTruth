import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { amazonAdapter } from "./amazon/index.js";
import { bestbuyAdapter } from "./bestbuy/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const amazonFixture = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(path.resolve(here, "../fixtures/amazon", name), "utf8"),
    "text/html",
  );
const bestbuyFixture = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(path.resolve(here, "../fixtures/bestbuy", name), "utf8"),
    "text/html",
  );

const NOW = new Date("2025-06-30T12:00:00.000Z");

describe("ExtractionMeta confidence fields", () => {
  it("amazon sale fixture populates HIGH identity/price/reference confidence", () => {
    const r = amazonAdapter.extract(
      amazonFixture("sale-with-list-price.html"),
      new URL("https://www.amazon.com/dp/B0DEMOASIN"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta).toMatchObject({
      adapterVersion: "amazon@1",
      identityMethod: "url_asin",
      identityConfidence: "HIGH",
      priceConfidence: "HIGH",
      referenceConfidence: "HIGH",
    });
    expect(r.meta.priceMethod).toBeTruthy();
    expect(r.meta.referenceMethod).toBeTruthy();
  });

  it("amazon no_price sets LOW priceConfidence", () => {
    const r = amazonAdapter.extract(
      amazonFixture("out-of-stock-no-price.html"),
      new URL("https://www.amazon.com/dp/B0NOSTOCKX"),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.meta?.identityConfidence).toBe("HIGH");
    expect(r.meta?.priceMethod).toBe("none");
    expect(r.meta?.priceConfidence).toBe("LOW");
  });

  it("amazon ambiguous_price sets AMBIGUOUS priceConfidence", () => {
    const r = amazonAdapter.extract(
      amazonFixture("multiple-visible-prices.html"),
      new URL("https://www.amazon.com/dp/B0MULTIVIS"),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.meta?.priceConfidence).toBe("AMBIGUOUS");
  });

  it("amazon JSON-LD fallback uses MEDIUM priceConfidence", () => {
    const r = amazonAdapter.extract(
      amazonFixture("jsonld-fallback.html"),
      new URL("https://www.amazon.com/dp/B0JSONLDFB"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.priceMethod).toBe("jsonld_offers_price");
    expect(r.meta.priceConfidence).toBe("MEDIUM");
    expect(r.meta.identityConfidence).toBe("HIGH");
  });

  it("amazon input#ASIN identity when URL has no ASIN still reports confidence", () => {
    const r = amazonAdapter.extract(
      amazonFixture("sale-with-list-price.html"),
      new URL("https://www.amazon.com/s?k=widget"),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_product_page");
    expect(r.meta?.adapterVersion).toBe("amazon@1");
  });

  it("bestbuy JSON-LD sku identity is HIGH", () => {
    const r = bestbuyAdapter.extract(
      bestbuyFixture("jsonld-sku.html"),
      new URL("https://www.bestbuy.com/product/acme-keyboard/ABCD1234XY"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta).toMatchObject({
      adapterVersion: "bestbuy@1",
      identityMethod: "jsonld_sku",
      identityConfidence: "HIGH",
      priceMethod: "price_block_customer",
      priceConfidence: "HIGH",
    });
  });

  it("bestbuy url_sku fallback is MEDIUM when page has no sku", () => {
    const bare = new DOMParser().parseFromString(
      `<html><body><div data-testid="price-block">
         <div data-testid="price-block-customer-price"><span class="sr-only">$19.99</span></div>
       </div></body></html>`,
      "text/html",
    );
    const r = bestbuyAdapter.extract(
      bare,
      new URL("https://www.bestbuy.com/site/acme/6418599.p?skuId=6418599"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.identityMethod).toBe("url_sku");
    expect(r.meta.identityConfidence).toBe("MEDIUM");
    expect(r.meta.priceConfidence).toBe("HIGH");
  });

  it("bestbuy reference confidence is HIGH for Comp. Value", () => {
    const r = bestbuyAdapter.extract(
      bestbuyFixture("comp-value.html"),
      new URL("https://www.bestbuy.com/product/acme-speaker/ABCDEF12"),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.referenceMethod).toBe("comp_value");
    expect(r.meta.referenceConfidence).toBe("HIGH");
  });

  it("bestbuy ambiguous_price sets AMBIGUOUS priceConfidence", () => {
    const r = bestbuyAdapter.extract(
      bestbuyFixture("multiple-price-blocks.html"),
      new URL("https://www.bestbuy.com/product/acme-tv/ABCDEF56"),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.meta?.priceConfidence).toBe("AMBIGUOUS");
    expect(r.meta?.identityConfidence).toBeTruthy();
  });
});
