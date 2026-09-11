import {
  OBSERVATION_SOURCES,
  parsePriceToCents,
  type RetailerObservation,
} from "@pricetruth/shared";
import { ADAPTER_VERSION } from "../index.js";
import type { ExtractionResult, RetailerAdapter } from "../types.js";
import { extractFirstPrice } from "../utils.js";
import { BESTBUY_SELECTORS as S } from "./selectors.js";

const PATH_SKU = /\/site\/[^/]+\/(\d{6,8})\.p/;
// New-format PDP: /product/<slug>/<opaque code> - may be followed by more
// path segments, e.g. /product/foo/J3GWRW4HCC/sku/6665563.
const PATH_PRODUCT = /^\/product\/[^/]+\/[A-Z0-9]{6,12}(?:\/|$)/i;
const PATH_PRODUCT_SKU = /^\/product\/[^/]+\/[A-Z0-9]{6,12}\/sku\/(\d{6,8})/i;
const SKU_PATTERN = /^\d{6,8}$/;
const SKU_LABEL = /^SKU:\s*(\d{6,8})$/i;

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").trim();
}

interface JsonLdProduct {
  name?: string;
  brand?: string | { name?: string };
  model?: string;
  mpn?: string;
  gtin13?: string;
  gtin12?: string;
  gtin?: string;
  sku?: string | number;
  offers?:
    | { price?: string | number; availability?: string; sku?: string | number }
    | Array<{ price?: string | number; availability?: string; sku?: string | number }>;
}

function findJsonLdProduct(doc: Document): JsonLdProduct | null {
  for (const script of doc.querySelectorAll(S.jsonLd)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      const graph: unknown[] = Array.isArray((c as { "@graph"?: unknown[] })?.["@graph"])
        ? ((c as { "@graph": unknown[] })["@graph"] as unknown[])
        : [c];
      for (const node of graph) {
        const type = (node as { "@type"?: string | string[] })?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("Product")) return node as JsonLdProduct;
      }
    }
  }
  return null;
}

function extractIdFromUrl(url: URL): string | null {
  const fromPath = url.pathname.match(PATH_SKU)?.[1];
  if (fromPath) return fromPath;
  const fromProductPath = url.pathname.match(PATH_PRODUCT_SKU)?.[1];
  if (fromProductPath) return fromProductPath;
  const skuId = url.searchParams.get("skuId");
  return skuId && SKU_PATTERN.test(skuId) ? skuId : null;
}

function extractJsonLdSku(product: JsonLdProduct | null): string | null {
  const candidates = [product?.sku, firstOffer(product)?.sku];
  for (const c of candidates) {
    const s = c?.toString().trim();
    if (s && SKU_PATTERN.test(s)) return s;
  }
  return null;
}

function extractSkuFromDoc(doc: Document, product: JsonLdProduct | null): string | null {
  const fromLd = extractJsonLdSku(product);
  if (fromLd) return fromLd;
  // New-format PDP: SKU appears as a "SKU: 10129617" label div.
  for (const el of doc.querySelectorAll(S.skuLabelText)) {
    const m = text(el).replace(/\s+/g, " ").match(SKU_LABEL);
    if (m?.[1]) return m[1];
  }
  const fromAttr = doc.querySelector(S.skuIdAttr)?.getAttribute("data-sku-id")?.trim();
  if (fromAttr && SKU_PATTERN.test(fromAttr)) return fromAttr;
  const spec = text(doc.querySelector(S.skuSpecValue)).replace(/^SKU:\s*/i, "");
  if (SKU_PATTERN.test(spec)) return spec;
  return null;
}

// Ancestor data-testids observed on /product/ pages that hold cross-sell,
// carousel, sponsored, warranty-tile, financing, open-box, or bundle-upsell
// price blocks - not the product's primary cash price.
const CONTAMINATED_ANCESTOR =
  /carousel|sponsored|accessor|cross-?sell|priceBlockTestId|financ|installment|open-?box|bundle|warranty|protection/i;

function inContaminatedSubtree(el: Element): boolean {
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (CONTAMINATED_ANCESTOR.test(n.getAttribute("data-testid") ?? "")) return true;
  }
  return false;
}

function mainPriceBlock(doc: Document): Element | null {
  for (const el of doc.querySelectorAll(S.priceBlock)) {
    if (!inContaminatedSubtree(el)) return el;
  }
  return null;
}

function firstUncontaminated(root: ParentNode, selector: string): Element | null {
  for (const el of root.querySelectorAll(selector)) {
    if (!inContaminatedSubtree(el)) return el;
  }
  return null;
}

function firstOffer(product: JsonLdProduct | null) {
  const offers = product?.offers;
  if (!offers) return undefined;
  return Array.isArray(offers) ? offers[0] : offers;
}

/** Copy that marks a dollar amount as financing / month, not cash price. */
const FINANCING_CTX = /\/\s*mo(?:nth)?\b|\bper\s+month\b|\b\d+\s+months?\b|\bfinancing\b|\baffirm\b/i;

type PriceOutcome =
  | { kind: "ok"; cents: number }
  | { kind: "none" }
  | { kind: "ambiguous" };

function looksLikeFinancing(el: Element | null): boolean {
  if (!el) return false;
  const host = el.closest('[data-testid="price-block"], [data-testid*="financ" i], [class*="financ" i]') ?? el.parentElement;
  return FINANCING_CTX.test(text(host).replace(/\s+/g, " "));
}

function domCustomerPrice(doc: Document, warnings: string[]): number | null {
  const block = mainPriceBlock(doc);
  if (block) {
    const el = block.querySelector(S.priceBlockCustomer);
    if (el && looksLikeFinancing(el)) {
      warnings.push("financing/month price ignored");
    } else {
      const cents = el ? parsePriceToCents(text(el)) : null;
      if (cents !== null) return cents;
    }
  }
  for (const sel of S.price) {
    const el = firstUncontaminated(doc, sel);
    if (!el) continue;
    if (looksLikeFinancing(el)) {
      warnings.push("financing/month price ignored");
      continue;
    }
    const cents = parsePriceToCents(text(el));
    if (cents !== null) return cents;
  }
  return null;
}

function extractPrice(
  doc: Document,
  product: JsonLdProduct | null,
  warnings: string[],
): PriceOutcome {
  let ldCents: number | null = null;
  const ldPrice = firstOffer(product)?.price;
  if (ldPrice !== undefined) {
    ldCents = parsePriceToCents(String(ldPrice));
    if (ldCents === null) warnings.push("JSON-LD offers.price did not parse");
  }

  const domCents = domCustomerPrice(doc, warnings);

  if (ldCents !== null && domCents !== null && ldCents !== domCents) {
    warnings.push("JSON-LD price conflicts with DOM price");
    return { kind: "ambiguous" };
  }

  const cents = ldCents ?? domCents;
  if (cents === null) {
    warnings.push("no price element matched");
    return { kind: "none" };
  }
  return { kind: "ok", cents };
}

function extractReference(doc: Document): number | null {
  const block = mainPriceBlock(doc);
  if (block) {
    for (const sel of [S.priceBlockCompValue, S.priceBlockRegular]) {
      const el = block.querySelector(sel);
      const cents = el ? (parsePriceToCents(text(el)) ?? extractFirstPrice(text(el))) : null;
      if (cents !== null) return cents;
    }
  }
  for (const sel of S.reference) {
    const el = firstUncontaminated(doc, sel);
    // "Was $399.99" / "Comp. Value: $274.99" - take the first $ amount.
    const cents = el ? (parsePriceToCents(text(el)) ?? extractFirstPrice(text(el))) : null;
    if (cents !== null) return cents;
  }
  return null;
}

function extractInStock(doc: Document, product: JsonLdProduct | null): boolean | undefined {
  const availability = firstOffer(product)?.availability;
  if (!availability) {
    // New-format PDP: an add-to-cart button implies sellable stock.
    return doc.querySelector(S.addToCart) ? true : undefined;
  }
  if (availability.includes("InStock")) return true;
  if (availability.includes("OutOfStock") || availability.includes("SoldOut")) return false;
  return undefined;
}

function extractBrand(product: JsonLdProduct | null): string | undefined {
  const brand = product?.brand;
  if (!brand) return undefined;
  return (typeof brand === "string" ? brand : brand.name) ?? undefined;
}

export const bestbuyAdapter: RetailerAdapter = {
  retailer: "bestbuy",

  matchesUrl(url: URL): boolean {
    if (!url.hostname.endsWith("bestbuy.com")) return false;
    return (
      PATH_SKU.test(url.pathname) ||
      PATH_PRODUCT.test(url.pathname) ||
      SKU_PATTERN.test(url.searchParams.get("skuId") ?? "")
    );
  },

  extractExternalId(url: URL, doc: Document): string | null {
    // Page SKU is authoritative (new-format URLs carry no SKU at all).
    return extractSkuFromDoc(doc, findJsonLdProduct(doc)) ?? extractIdFromUrl(url);
  },

  extract(doc: Document, url: URL, now: Date): ExtractionResult {
    const warnings: string[] = [];
    if (!this.matchesUrl(url)) {
      return { ok: false, reason: "not_product_page", warnings };
    }
    const product = findJsonLdProduct(doc);
    const urlSku = extractIdFromUrl(url);
    const jsonLdSku = extractJsonLdSku(product);
    const externalId = extractSkuFromDoc(doc, product) ?? urlSku;
    if (urlSku && jsonLdSku && urlSku !== jsonLdSku) {
      warnings.push("url sku differs from page sku");
    }
    if (!externalId) {
      return { ok: false, reason: "no_identifier", warnings };
    }

    const priceOutcome = extractPrice(doc, product, warnings);
    if (priceOutcome.kind === "none") {
      return { ok: false, reason: "no_price", warnings };
    }
    if (priceOutcome.kind === "ambiguous") {
      return { ok: false, reason: "ambiguous_price", warnings };
    }
    const priceCents = priceOutcome.cents;

    let referencePriceCents = extractReference(doc) ?? undefined;
    if (referencePriceCents !== undefined && referencePriceCents <= priceCents) {
      warnings.push("reference price not above price; dropped");
      referencePriceCents = undefined;
    }

    const title =
      product?.name?.trim() || text(doc.querySelector("h1")) || text(doc.querySelector("title"));

    const observation: RetailerObservation = {
      retailer: "bestbuy",
      externalId,
      url: url.href,
      title,
      brand: extractBrand(product),
      modelNumber: product?.model ?? product?.mpn ?? undefined,
      gtin: product?.gtin13 ?? product?.gtin12 ?? product?.gtin ?? undefined,
      priceCents,
      referencePriceCents,
      currency: "USD",
      inStock: extractInStock(doc, product),
      source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
      observedAt: now.toISOString(),
      schemaVersion: 1,
      priceType: "STANDARD",
      referenceType: referencePriceCents !== undefined ? "UNKNOWN" : undefined,
      extractorVersion: ADAPTER_VERSION,
    };
    return { ok: true, observation, warnings };
  },
};
