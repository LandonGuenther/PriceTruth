/**
 * Best Buy DOM selectors. Hand-maintained; every selector must be exercised by
 * at least one fixture under fixtures/bestbuy/.
 */
export const BESTBUY_SELECTORS = {
  /** Embedded JSON-LD blocks; we scan for the one with @type "Product". */
  jsonLd: 'script[type="application/ld+json"]',
  /** Elements carrying the sku id (e.g. the product container). */
  skuIdAttr: "[data-sku-id]",
  /** Spec-table SKU row value ("SKU: 6418599"). */
  skuSpecValue: ".sku .product-data-value",
  /** "Was $X" / "Reg $X" regular price shown next to the sale price. */
  reference: [
    ".pricing-price__regular-price",
    '[data-testid="regular-price"]',
    ".pricing-price__savings-regular-price",
  ],
  /** Customer price fallbacks when JSON-LD is absent or lacks offers. */
  price: [
    ".priceView-customer-price > span:first-child",
    '[data-testid="customer-price"] span',
    ".priceView-hero-price span",
  ],
} as const;
