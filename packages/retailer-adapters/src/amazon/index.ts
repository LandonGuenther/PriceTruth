import {
  OBSERVATION_SOURCES,
  parsePriceToCents,
  type RetailerObservation,
} from "@pricetruth/shared";
import { ADAPTER_VERSION } from "../index.js";
import type { ExtractionResult, RetailerAdapter } from "../types.js";
import { AMAZON_SELECTORS as S } from "./selectors.js";

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

function extractPrice(doc: Document, warnings: string[]): number | null {
  for (const sel of S.price) {
    const el = doc.querySelector(sel);
    const cents = el ? parsePriceToCents(text(el)) : null;
    if (cents !== null) return cents;
  }
  // Split-price fallback: ".a-price-whole" + ".a-price-fraction".
  const whole = text(doc.querySelector(S.priceWhole)).replace(/[^0-9]/g, "");
  const fraction = text(doc.querySelector(S.priceFraction)).replace(/[^0-9]/g, "");
  if (whole) {
    const cents = parsePriceToCents(`${whole}.${fraction || "00"}`);
    if (cents !== null) return cents;
  }
  warnings.push("no price element matched");
  return null;
}

function extractReference(doc: Document): number | null {
  for (const sel of S.reference) {
    const el = doc.querySelector(sel);
    const cents = el ? parsePriceToCents(text(el)) : null;
    if (cents !== null) return cents;
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

    const priceCents = extractPrice(doc, warnings);
    if (priceCents === null) {
      return { ok: false, reason: "no_price", warnings };
    }

    let referencePriceCents = extractReference(doc) ?? undefined;
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
