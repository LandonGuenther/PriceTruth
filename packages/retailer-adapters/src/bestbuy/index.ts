import {
  OBSERVATION_SOURCES,
  parsePriceToCents,
  type RetailerObservation,
} from "@pricetruth/shared";
import type { ExtractionResult, RetailerAdapter } from "../types.js";
import { BESTBUY_SELECTORS as S } from "./selectors.js";

const PATH_SKU = /\/site\/[^/]+\/(\d{6,8})\.p/;
const SKU_PATTERN = /^\d{6,8}$/;

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
    | { price?: string | number; availability?: string }
    | Array<{ price?: string | number; availability?: string }>;
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
  const skuId = url.searchParams.get("skuId");
  return skuId && SKU_PATTERN.test(skuId) ? skuId : null;
}

function extractSkuFromDoc(doc: Document, product: JsonLdProduct | null): string | null {
  const fromLd = product?.sku?.toString();
  if (fromLd && SKU_PATTERN.test(fromLd)) return fromLd;
  const fromAttr = doc.querySelector(S.skuIdAttr)?.getAttribute("data-sku-id")?.trim();
  if (fromAttr && SKU_PATTERN.test(fromAttr)) return fromAttr;
  const spec = text(doc.querySelector(S.skuSpecValue)).replace(/^SKU:\s*/i, "");
  if (SKU_PATTERN.test(spec)) return spec;
  return null;
}

function firstOffer(product: JsonLdProduct | null) {
  const offers = product?.offers;
  if (!offers) return undefined;
  return Array.isArray(offers) ? offers[0] : offers;
}

function extractPrice(
  doc: Document,
  product: JsonLdProduct | null,
  warnings: string[],
): number | null {
  const ldPrice = firstOffer(product)?.price;
  if (ldPrice !== undefined) {
    const cents = parsePriceToCents(String(ldPrice));
    if (cents !== null) return cents;
    warnings.push("JSON-LD offers.price did not parse");
  }
  for (const sel of S.price) {
    const el = doc.querySelector(sel);
    const cents = el ? parsePriceToCents(text(el)) : null;
    if (cents !== null) return cents;
  }
  warnings.push("no price element matched");
  return null;
}

function extractReference(doc: Document): number | null {
  for (const sel of S.reference) {
    const el = doc.querySelector(sel);
    // "Was $399.99" / "Reg $399.99" — parsePriceToCents strips the words.
    const cents = el ? parsePriceToCents(text(el)) : null;
    if (cents !== null) return cents;
  }
  return null;
}

function extractInStock(product: JsonLdProduct | null): boolean | undefined {
  const availability = firstOffer(product)?.availability;
  if (!availability) return undefined;
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
    return PATH_SKU.test(url.pathname) || SKU_PATTERN.test(url.searchParams.get("skuId") ?? "");
  },

  extractExternalId(url: URL, doc: Document): string | null {
    return extractIdFromUrl(url) ?? extractSkuFromDoc(doc, findJsonLdProduct(doc));
  },

  extract(doc: Document, url: URL, now: Date): ExtractionResult {
    const warnings: string[] = [];
    if (!this.matchesUrl(url)) {
      return { ok: false, reason: "not_product_page", warnings };
    }
    const product = findJsonLdProduct(doc);
    const externalId = extractIdFromUrl(url) ?? extractSkuFromDoc(doc, product);
    if (!externalId) {
      return { ok: false, reason: "no_identifier", warnings };
    }

    const priceCents = extractPrice(doc, product, warnings);
    if (priceCents === null) {
      return { ok: false, reason: "no_price", warnings };
    }

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
      inStock: extractInStock(product),
      source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
      observedAt: now.toISOString(),
    };
    return { ok: true, observation, warnings };
  },
};
