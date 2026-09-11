import {
  OBSERVATION_SOURCES,
  parsePriceToCents,
  type RetailerObservation,
} from "@pricetruth/shared";
import { ADAPTER_VERSION } from "../index.js";
import type { ExtractionResult, RetailerAdapter } from "../types.js";
import { AMAZON_SELECTORS as S, HIDDEN_PRICE_TEXT } from "./selectors.js";

const PATH_ID = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/;

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").trim();
}

function extractIdFromUrl(url: URL): string | null {
  return url.pathname.match(PATH_ID)?.[1] ?? null;
}

function extractAsinFromDoc(doc: Document): string | null {
  const input = doc.querySelector<HTMLInputElement>(S.asinInput)?.value?.trim();
  if (input && /^[A-Z0-9]{10}$/.test(input)) return input;
  const dp = doc.querySelector(S.dpDataAsin)?.getAttribute("data-asin")?.trim();
  if (dp && /^[A-Z0-9]{10}$/.test(dp)) return dp;
  for (const el of doc.querySelectorAll(S.detailBullets)) {
    const t = text(el);
    const m = t.match(/ASIN[^A-Z0-9]*([A-Z0-9]{10})/);
    if (m) return m[1] ?? null;
  }
  return null;
}

/**
 * Every ASIN the page may legitimately use for its own product: the URL id
 * plus input#ASIN and #dp[data-asin] — on variant pages the selected child
 * ASIN differs from the URL's parent ASIN and both are "self".
 */
function selfAsins(doc: Document, externalId: string): Set<string> {
  const set = new Set<string>([externalId]);
  const input = doc.querySelector<HTMLInputElement>(S.asinInput)?.value?.trim();
  if (input && /^[A-Z0-9]{10}$/.test(input)) set.add(input);
  const dp = doc.querySelector(S.dpDataAsin)?.getAttribute("data-asin")?.trim();
  if (dp && /^[A-Z0-9]{10}$/.test(dp)) set.add(dp);
  return set;
}

/**
 * A price element inside a subtree marked data-asin=<different ASIN> belongs
 * to a cross-sell/carousel product, not the page's product — reject it.
 */
function foreignAsin(el: Element, selfAsins: Set<string>, warnings: string[]): boolean {
  const asin = el.closest("[data-asin]")?.getAttribute("data-asin")?.trim();
  if (asin && !selfAsins.has(asin)) {
    warnings.push(`price element belongs to another ASIN (${asin}); ignored`);
    return true;
  }
  return false;
}

/** A price element inside a per-unit container is a unit price — reject it. */
function perUnitPrice(el: Element, warnings: string[]): boolean {
  if (el.closest(S.unitPriceContainers)) {
    warnings.push("per-unit price ignored");
    return true;
  }
  return false;
}

function extractPrice(
  doc: Document,
  warnings: string[],
  externalId: string,
  self: Set<string>,
): number | null {
  for (const sel of S.price) {
    for (const el of doc.querySelectorAll(sel)) {
      if (foreignAsin(el, self, warnings) || perUnitPrice(el, warnings)) continue;
      const cents = parsePriceToCents(text(el));
      if (cents !== null) return cents;
    }
  }
  // Split-price fallback, but only inside a buy-box container — a global
  // .a-price-whole/.a-price-fraction search leaks carousel prices.
  for (const boxSel of S.priceContainers) {
    const box = doc.querySelector(boxSel);
    if (!box) continue;
    for (const el of box.querySelectorAll(S.priceWhole)) {
      if (foreignAsin(el, self, warnings) || perUnitPrice(el, warnings)) continue;
      const whole = text(el).replace(/[^0-9]/g, "");
      if (!whole) continue;
      const fraction = text(
        el.parentElement?.querySelector(S.priceFraction) ?? box.querySelector(S.priceFraction),
      ).replace(/[^0-9]/g, "");
      const cents = parsePriceToCents(`${whole}.${fraction || "00"}`);
      if (cents !== null) return cents;
    }
  }
  if (HIDDEN_PRICE_TEXT.test(text(doc.querySelector(S.hiddenPriceRegions)))) {
    warnings.push("price hidden until add-to-cart");
  } else {
    warnings.push("no price element matched");
  }
  return null;
}

function extractReference(doc: Document, warnings: string[], self: Set<string>): number | null {
  for (const sel of S.reference) {
    for (const el of doc.querySelectorAll(sel)) {
      if (foreignAsin(el, self, warnings) || perUnitPrice(el, warnings)) continue;
      const cents = parsePriceToCents(text(el));
      if (cents !== null) return cents;
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

export const amazonAdapter: RetailerAdapter = {
  retailer: "amazon",

  matchesUrl(url: URL): boolean {
    return url.hostname.endsWith("amazon.com") && PATH_ID.test(url.pathname);
  },

  extractExternalId(url: URL, doc: Document): string | null {
    return extractIdFromUrl(url) ?? extractAsinFromDoc(doc);
  },

  extract(doc: Document, url: URL, now: Date): ExtractionResult {
    const warnings: string[] = [];
    if (!this.matchesUrl(url)) {
      return { ok: false, reason: "not_product_page", warnings };
    }

    const externalId = this.extractExternalId(url, doc);
    if (!externalId) {
      return { ok: false, reason: "no_identifier", warnings };
    }

    const self = selfAsins(doc, externalId);
    const priceCents = extractPrice(doc, warnings, externalId, self);
    if (priceCents === null) {
      return { ok: false, reason: "no_price", warnings };
    }

    let referencePriceCents = extractReference(doc, warnings, self) ?? undefined;
    if (referencePriceCents !== undefined && referencePriceCents <= priceCents) {
      warnings.push("reference price not above price; dropped");
      referencePriceCents = undefined;
    }

    const observation: RetailerObservation = {
      retailer: "amazon",
      externalId,
      url: url.href,
      title: text(doc.querySelector(S.title)) || text(doc.querySelector("title")),
      brand: extractBrand(doc),
      modelNumber: extractModelNumber(doc),
      priceCents,
      referencePriceCents,
      currency: "USD",
      inStock: extractInStock(doc),
      variant: extractVariant(doc),
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
