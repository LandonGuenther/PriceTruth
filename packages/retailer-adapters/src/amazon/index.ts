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
import { AMAZON_SELECTORS as S } from "./selectors.js";

export const AMAZON_ADAPTER_VERSION = "amazon@1";

const PATH_ID = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/;

/**
 * Ancestor id/class/testid patterns that must never contribute a primary price:
 * carousel / sponsored / used / SNS secondary / installment / coupon / shipping /
 * all-offers / OLP buying-options walls.
 */
const CONTAMINATED =
  /carousel|sponsored|sims-|sp_detail|accessory|cross.?sell|usedBuyBox|usedAccordion|olp-used|olp_|aod-|all.?offers|buying.?options|offer-display-feature.*used|subscribe.?and.?save|snsPrice|snsDetail|installment|apr\b|coupon|clip.?coupon|promoPriceBlock|shippingMessage|deliveryBlock|secondaryOffer|twisterPlusPrice|savings-coupon/i;

const INSTALLMENT_TEXT = /as low as|\/\s*mo(?:nth)?\b|apr\b|financ/i;
const COUPON_TEXT = /coupon|save\s+\$?\d/i;
const USED_TEXT = /^\s*used\b|buy used|renewed/i;

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").trim();
}

function extractIdFromUrl(url: URL): string | null {
  return url.pathname.match(PATH_ID)?.[1] ?? null;
}

function extractAsinFromInput(doc: Document): string | null {
  const input = doc.querySelector<HTMLInputElement>(S.asinInput)?.value?.trim();
  return input && /^[A-Z0-9]{10}$/.test(input) ? input : null;
}

function extractAsinFromDp(doc: Document): string | null {
  const dp = doc.querySelector(S.dpDataAsin)?.getAttribute("data-asin")?.trim();
  return dp && /^[A-Z0-9]{10}$/.test(dp) ? dp : null;
}

function extractAsinFromBullets(doc: Document): string | null {
  for (const el of doc.querySelectorAll(S.detailBullets)) {
    const t = text(el);
    const m = t.match(/ASIN[^A-Z0-9]*([A-Z0-9]{10})/);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** ASIN precedence: URL > input#ASIN > #dp[data-asin] > detail bullets. */
function resolveIdentity(
  url: URL,
  doc: Document,
): { externalId: string | null; method?: string; confidence?: ExtractionConfidence } {
  const fromUrl = extractIdFromUrl(url);
  if (fromUrl) return { externalId: fromUrl, method: "url_asin", confidence: "HIGH" };
  const fromInput = extractAsinFromInput(doc);
  if (fromInput) return { externalId: fromInput, method: "input_asin", confidence: "HIGH" };
  const fromDp = extractAsinFromDp(doc);
  if (fromDp) return { externalId: fromDp, method: "dp_data_asin", confidence: "MEDIUM" };
  const fromBullets = extractAsinFromBullets(doc);
  if (fromBullets) {
    return { externalId: fromBullets, method: "detail_bullets", confidence: "MEDIUM" };
  }
  return { externalId: null };
}

function isContaminated(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const id = n.id ?? "";
    const cls = typeof n.className === "string" ? n.className : String(n.className ?? "");
    const testid = n.getAttribute("data-testid") ?? "";
    const csa = n.getAttribute("data-csa-c-content-id") ?? "";
    const combined = `${id} ${cls} ${testid} ${csa}`;
    if (CONTAMINATED.test(combined)) return true;
  }
  return false;
}

function looksLikeNonBuyBoxPrice(el: Element): boolean {
  const nearby = text(el.closest("div, span, li, td") ?? el);
  if (INSTALLMENT_TEXT.test(nearby) && !nearby.match(/\$[\d,]+\.\d{2}/)) return true;
  // Installment lines often embed a monthly amount; reject when /mo is present.
  if (/\/\s*mo(?:nth)?\b/i.test(nearby) || /\bas low as\b/i.test(nearby)) return true;
  if (COUPON_TEXT.test(nearby) && /coupon/i.test(nearby)) {
    // Coupon badge with its own $ amount next to buy box - not the price to pay.
    const parentId = el.closest("[id]")?.id ?? "";
    if (/coupon/i.test(parentId) || /coupon/i.test(el.className?.toString?.() ?? "")) return true;
  }
  const usedAncestor = el.closest(
    "#usedBuyBox, #usedAccordionRow, [id*='used'], [class*='used-offer'], [data-csa-c-content-id*='used']",
  );
  if (usedAncestor) return true;
  const label = text(el.parentElement);
  if (USED_TEXT.test(label)) return true;
  return false;
}

interface PriceCandidate {
  cents: number;
  method: string;
  /** Lower is better. */
  priority: number;
}

function parseCents(raw: string): number | null {
  return parsePriceToCents(raw.replace(/\u00a0/g, " ").trim());
}

function collectOffscreen(root: Element, selector: string, method: string, priority: number): PriceCandidate[] {
  const out: PriceCandidate[] = [];
  for (const el of root.querySelectorAll(selector)) {
    if (isContaminated(el) || looksLikeNonBuyBoxPrice(el)) continue;
    const cents = parseCents(text(el));
    if (cents !== null) out.push({ cents, method, priority });
  }
  return out;
}

function collectSplitPrice(root: Element, priority: number): PriceCandidate[] {
  const out: PriceCandidate[] = [];
  for (const price of root.querySelectorAll(S.aPrice)) {
    if (isContaminated(price) || looksLikeNonBuyBoxPrice(price)) continue;
    // Prefer offscreen when present on this same .a-price.
    if (price.querySelector(".a-offscreen")) continue;
    const wholeEl = price.querySelector(S.priceWhole);
    if (!wholeEl) continue;
    const whole = text(wholeEl).replace(/[^0-9]/g, "");
    const fraction = text(price.querySelector(S.priceFraction)).replace(/[^0-9]/g, "") || "00";
    if (!whole) continue;
    const cents = parseCents(`${whole}.${fraction}`);
    if (cents !== null) {
      out.push({ cents, method: "split_whole_fraction", priority });
    }
  }
  return out;
}

function collectLegacyPrices(doc: Document): PriceCandidate[] {
  const out: PriceCandidate[] = [];
  for (const sel of S.legacyPrice) {
    const el = doc.querySelector(sel);
    if (!el || isContaminated(el) || looksLikeNonBuyBoxPrice(el)) continue;
    const cents = parseCents(text(el));
    if (cents !== null) out.push({ cents, method: `legacy:${sel}`, priority: 40 });
  }
  return out;
}

interface JsonLdProduct {
  offers?:
    | { price?: string | number }
    | Array<{ price?: string | number }>;
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

function extractJsonLdPrice(doc: Document): PriceCandidate | null {
  const product = findJsonLdProduct(doc);
  const offers = product?.offers;
  if (!offers) return null;
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (first?.price === undefined) return null;
  const cents = parseCents(String(first.price));
  if (cents === null) return null;
  return { cents, method: "jsonld_offers_price", priority: 50 };
}

type PriceOutcome =
  | { kind: "ok"; cents: number; method: string; confidence: ExtractionConfidence }
  | { kind: "ambiguous"; candidates: number[]; method: string }
  | { kind: "none" };

function extractPrice(doc: Document, warnings: string[]): PriceOutcome {
  const candidates: PriceCandidate[] = [];

  for (const rootSel of S.priceRoots) {
    const root = doc.querySelector(rootSel);
    if (!root || isContaminated(root)) continue;
    candidates.push(
      ...collectOffscreen(root, S.priceToPayOffscreen, `core:priceToPay:${rootSel}`, 10),
    );
    candidates.push(
      ...collectOffscreen(root, S.priceOffscreen, `core:a-price:${rootSel}`, 20),
    );
    candidates.push(...collectSplitPrice(root, 30));
  }

  candidates.push(...collectLegacyPrices(doc));

  if (candidates.length === 0) {
    const fromLd = extractJsonLdPrice(doc);
    if (fromLd) {
      return {
        kind: "ok",
        cents: fromLd.cents,
        method: fromLd.method,
        confidence: "MEDIUM",
      };
    }
    warnings.push("no price element matched");
    return { kind: "none" };
  }

  // Prefer the best (lowest) priority band; within it, all cents must agree.
  const bestPriority = Math.min(...candidates.map((c) => c.priority));
  const top = candidates.filter((c) => c.priority === bestPriority);
  const unique = [...new Set(top.map((c) => c.cents))];
  if (unique.length > 1) {
    warnings.push(`conflicting primary prices: ${unique.join(",")}`);
    return { kind: "ambiguous", candidates: unique, method: top[0]?.method ?? "conflict" };
  }

  const winner = top[0]!;
  const confidence: ExtractionConfidence =
    winner.priority <= 10 ? "HIGH" : winner.priority <= 20 ? "HIGH" : "MEDIUM";
  return { kind: "ok", cents: winner.cents, method: winner.method, confidence };
}

function extractReference(
  doc: Document,
): { cents: number; method: string; confidence: ExtractionConfidence } | null {
  for (const sel of S.reference) {
    const el = doc.querySelector(sel);
    if (!el || isContaminated(el)) continue;
    const cents = parseCents(text(el));
    if (cents !== null) {
      return { cents, method: `reference:${sel}`, confidence: "HIGH" };
    }
  }
  return null;
}

function extractBrand(doc: Document): string | undefined {
  const byline = text(doc.querySelector(S.byline));
  const m = byline.match(/^(?:Visit the (.+?) Store|Brand:\s*(.+))$/i);
  if (m) return (m[1] ?? m[2] ?? "").trim() || undefined;
  for (const row of doc.querySelectorAll(S.overviewRows)) {
    const label = text(row.querySelector("td, th, .a-span3")).toLowerCase();
    if (label === "brand") {
      const value = text(row.querySelector("td:last-child, .a-span9"));
      if (value) return value;
    }
  }
  return undefined;
}

function extractModelNumber(doc: Document): string | undefined {
  for (const row of doc.querySelectorAll(`${S.overviewRows}, ${S.detailRows}`)) {
    const t = text(row);
    const m = t.match(/(?:Model Name|Item model number)\s*[:\u200e]?\s*(.+)/i);
    if (m?.[1]) return m[1].trim() || undefined;
  }
  return undefined;
}

function extractInStock(doc: Document): boolean | undefined {
  const t = text(doc.querySelector(S.availability)).toLowerCase();
  if (!t) return undefined;
  if (t.includes("in stock")) return true;
  if (t.includes("unavailable") || t.includes("out of stock")) return false;
  return undefined;
}

function extractVariant(doc: Document): Record<string, string> | undefined {
  const variant: Record<string, string> = {};
  for (const row of doc.querySelectorAll(S.variationRow)) {
    const value = text(row.querySelector(S.variationValue));
    if (!value) continue;
    const key =
      text(row.querySelector(S.variationLabel)).replace(/:$/, "") ||
      row.getAttribute("id")?.replace(/^variation_/, "") ||
      "option";
    variant[key] = value;
  }
  return Object.keys(variant).length > 0 ? variant : undefined;
}

function baseMeta(warnings: string[], partial: Partial<ExtractionMeta> = {}): ExtractionMeta {
  return {
    adapterVersion: AMAZON_ADAPTER_VERSION,
    warnings: [...warnings],
    ...partial,
  };
}

export const amazonAdapter: RetailerAdapter = {
  retailer: "amazon",

  matchesUrl(url: URL): boolean {
    return url.hostname.endsWith("amazon.com") && PATH_ID.test(url.pathname);
  },

  extractExternalId(url: URL, doc: Document): string | null {
    return resolveIdentity(url, doc).externalId;
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

    const identity = resolveIdentity(url, doc);
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

    const price = extractPrice(doc, warnings);
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

    const observation: RetailerObservation = {
      retailer: "amazon",
      externalId: identity.externalId,
      url: url.href,
      title: text(doc.querySelector(S.title)) || text(doc.querySelector("title")),
      brand: extractBrand(doc),
      modelNumber: extractModelNumber(doc),
      priceCents: price.cents,
      referencePriceCents,
      currency: "USD",
      inStock: extractInStock(doc),
      variant: extractVariant(doc),
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
