import {
  OBSERVATION_SOURCES,
  parsePriceToCents,
  type RetailerObservation,
} from "@pricetruth/shared";
import type {
  ExtractionConfidence,
  ExtractionMeta,
  ExtractionResult,
  RetailerAdapter,
} from "../types.js";
import { extractFirstPrice } from "../utils.js";
import { BESTBUY_SELECTORS as S } from "./selectors.js";

export const BESTBUY_ADAPTER_VERSION = "bestbuy@1";

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

function resolveIdentity(
  url: URL,
  doc: Document,
  product: JsonLdProduct | null,
): { externalId: string | null; method?: string; confidence?: ExtractionConfidence } {
  const pageSku = extractSkuFromDoc(doc, product);
  if (pageSku) {
    const method = extractJsonLdSku(product)
      ? "jsonld_sku"
      : doc.querySelector(S.skuLabelText)
        ? "sku_label"
        : doc.querySelector(S.skuIdAttr)
          ? "data_sku_id"
          : "sku_spec";
    return { externalId: pageSku, method, confidence: "HIGH" };
  }
  const urlSku = extractIdFromUrl(url);
  if (urlSku) return { externalId: urlSku, method: "url_sku", confidence: "MEDIUM" };
  return { externalId: null };
}

// Ancestor data-testids / classes that hold cross-sell, carousel, sponsored,
// warranty, marketplace-adjacent, or review-rail price blocks.
const CONTAMINATED_ANCESTOR =
  /carousel|sponsored|accessor|cross-?sell|priceBlockTestId|marketplace|fulfilled-by|review|ratings-overview|also-viewed|similar-items|warranty|protection.?plan/i;

function inContaminatedSubtree(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const testid = n.getAttribute("data-testid") ?? "";
    const cls = typeof n.className === "string" ? n.className : String(n.className ?? "");
    const id = n.id ?? "";
    if (CONTAMINATED_ANCESTOR.test(`${testid} ${cls} ${id}`)) return true;
  }
  return false;
}

/** Comp. Value / Was text must never be treated as the customer price. */
function isReferenceOnlyNode(el: Element): boolean {
  const testid = el.getAttribute("data-testid") ?? "";
  const lu = el.getAttribute("data-lu-target") ?? "";
  if (/regular-price|comp_value/i.test(`${testid} ${lu}`)) return true;
  if (el.closest('[data-testid="price-block-regular-price"]')) return true;
  if (el.closest('[data-lu-target="comp_value"]')) return true;
  const t = text(el);
  if (/comp\.?\s*value|^\s*was\b|^\s*reg\.?\b/i.test(t) && !/customer/i.test(testid)) {
    return true;
  }
  return false;
}

function uncontaminatedPriceBlocks(doc: Document): Element[] {
  const blocks: Element[] = [];
  for (const el of doc.querySelectorAll(S.priceBlock)) {
    if (!inContaminatedSubtree(el)) blocks.push(el);
  }
  return blocks;
}

function firstUncontaminated(root: ParentNode, selector: string): Element | null {
  for (const el of root.querySelectorAll(selector)) {
    if (inContaminatedSubtree(el) || isReferenceOnlyNode(el)) continue;
    return el;
  }
  return null;
}

function firstOffer(product: JsonLdProduct | null) {
  const offers = product?.offers;
  if (!offers) return undefined;
  return Array.isArray(offers) ? offers[0] : offers;
}

type PriceOutcome =
  | { kind: "ok"; cents: number; method: string; confidence: ExtractionConfidence }
  | { kind: "ambiguous"; method: string }
  | { kind: "none" };

function customerCentsFromBlock(block: Element): number | null {
  const el = block.querySelector(S.priceBlockCustomer);
  if (!el) return null;
  return parsePriceToCents(text(el));
}

function extractPrice(
  doc: Document,
  product: JsonLdProduct | null,
  warnings: string[],
): PriceOutcome {
  const blocks = uncontaminatedPriceBlocks(doc);
  const blockPrices: number[] = [];
  for (const block of blocks) {
    const cents = customerCentsFromBlock(block);
    if (cents !== null) blockPrices.push(cents);
  }
  const uniqueBlock = [...new Set(blockPrices)];
  if (uniqueBlock.length > 1) {
    warnings.push(`conflicting price blocks: ${uniqueBlock.join(",")}`);
    return { kind: "ambiguous", method: "price_block_conflict" };
  }
  if (uniqueBlock.length === 1) {
    return {
      kind: "ok",
      cents: uniqueBlock[0]!,
      method: "price_block_customer",
      confidence: "HIGH",
    };
  }

  for (const sel of S.price) {
    const el = firstUncontaminated(doc, sel);
    const cents = el ? parsePriceToCents(text(el)) : null;
    if (cents !== null) {
      return { kind: "ok", cents, method: `dom:${sel}`, confidence: "MEDIUM" };
    }
  }

  const ldPrice = firstOffer(product)?.price;
  if (ldPrice !== undefined) {
    const cents = parsePriceToCents(String(ldPrice));
    if (cents !== null) {
      return { kind: "ok", cents, method: "jsonld_offers_price", confidence: "MEDIUM" };
    }
    warnings.push("JSON-LD offers.price did not parse");
  }

  warnings.push("no price element matched");
  return { kind: "none" };
}

function extractReference(
  doc: Document,
): { cents: number; method: string; confidence: ExtractionConfidence } | null {
  const blocks = uncontaminatedPriceBlocks(doc);
  for (const block of blocks) {
    for (const sel of [S.priceBlockCompValue, S.priceBlockRegular]) {
      const el = block.querySelector(sel);
      const cents = el ? (parsePriceToCents(text(el)) ?? extractFirstPrice(text(el))) : null;
      if (cents !== null) {
        return {
          cents,
          method: sel.includes("comp_value") ? "comp_value" : "regular_price",
          confidence: "HIGH",
        };
      }
    }
  }
  for (const sel of S.reference) {
    const el = (() => {
      for (const candidate of doc.querySelectorAll(sel)) {
        if (!inContaminatedSubtree(candidate)) return candidate;
      }
      return null;
    })();
    const cents = el ? (parsePriceToCents(text(el)) ?? extractFirstPrice(text(el))) : null;
    if (cents !== null) {
      return { cents, method: `reference:${sel}`, confidence: "MEDIUM" };
    }
  }
  return null;
}

function extractInStock(doc: Document, product: JsonLdProduct | null): boolean | undefined {
  const availability = firstOffer(product)?.availability;
  if (!availability) {
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

function baseMeta(warnings: string[], partial: Partial<ExtractionMeta> = {}): ExtractionMeta {
  return {
    adapterVersion: BESTBUY_ADAPTER_VERSION,
    warnings: [...warnings],
    ...partial,
  };
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
    return resolveIdentity(url, doc, findJsonLdProduct(doc)).externalId;
  },

  extract(doc: Document, url: URL, now: Date): ExtractionResult {
    const warnings: string[] = [];
    if (!this.matchesUrl(url)) {
      return {
        ok: false,
        reason: "not_product_page",
        warnings,
        meta: baseMeta(warnings),
      };
    }
    const product = findJsonLdProduct(doc);
    const urlSku = extractIdFromUrl(url);
    const jsonLdSku = extractJsonLdSku(product);
    const identity = resolveIdentity(url, doc, product);
    if (urlSku && jsonLdSku && urlSku !== jsonLdSku) {
      warnings.push("url sku differs from page sku");
    }
    if (doc.querySelector(S.marketplaceBadge)) {
      warnings.push("marketplace badge present");
    }
    if (!identity.externalId) {
      return {
        ok: false,
        reason: "no_identifier",
        warnings,
        meta: baseMeta(warnings, {
          identityMethod: "none",
          identityConfidence: "LOW",
        }),
      };
    }

    const price = extractPrice(doc, product, warnings);
    if (price.kind === "ambiguous") {
      return {
        ok: false,
        reason: "ambiguous_price",
        warnings,
        meta: baseMeta(warnings, {
          identityMethod: identity.method,
          identityConfidence: identity.confidence,
          priceMethod: price.method,
          priceConfidence: "AMBIGUOUS",
        }),
      };
    }
    if (price.kind === "none") {
      return {
        ok: false,
        reason: "no_price",
        warnings,
        meta: baseMeta(warnings, {
          identityMethod: identity.method,
          identityConfidence: identity.confidence,
          priceMethod: "none",
          priceConfidence: "LOW",
        }),
      };
    }

    let referencePriceCents: number | undefined;
    let referenceMethod: string | undefined;
    let referenceConfidence: ExtractionConfidence | undefined;
    const ref = extractReference(doc);
    if (ref) {
      if (ref.cents <= price.cents) {
        warnings.push("reference price not above price; dropped");
      } else {
        referencePriceCents = ref.cents;
        referenceMethod = ref.method;
        referenceConfidence = ref.confidence;
      }
    }

    const title =
      product?.name?.trim() || text(doc.querySelector("h1")) || text(doc.querySelector("title"));

    const observation: RetailerObservation = {
      retailer: "bestbuy",
      externalId: identity.externalId,
      url: url.href,
      title,
      brand: extractBrand(product),
      modelNumber: product?.model ?? product?.mpn ?? undefined,
      gtin: product?.gtin13 ?? product?.gtin12 ?? product?.gtin ?? undefined,
      priceCents: price.cents,
      referencePriceCents,
      currency: "USD",
      inStock: extractInStock(doc, product),
      source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
      observedAt: now.toISOString(),
    };

    return {
      ok: true,
      observation,
      warnings,
      meta: baseMeta(warnings, {
        identityMethod: identity.method,
        identityConfidence: identity.confidence,
        priceMethod: price.method,
        priceConfidence: price.confidence,
        referenceMethod,
        referenceConfidence,
      }),
    };
  },
};
