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
  /** New-format PDP: "SKU: 10129617" / "Model: …" label divs under the title. */
  skuLabelText: ".pr-200.inline-block",
  /** New-format PDP price blocks; the main one must not sit in a carousel/tile. */
  priceBlock: '[data-testid="price-block"]',
  /** Inside the main price block: screen-reader customer price text. */
  priceBlockCustomer: '[data-testid="price-block-customer-price"] .sr-only',
  /** Inside the main price block: "Comp. Value" amount. */
  priceBlockCompValue: '[data-testid="price-block-regular-price"] [data-lu-target="comp_value"]',
  /** Inside the main price block: whole regular-price row (first $ amount). */
  priceBlockRegular: '[data-testid="price-block-regular-price"]',
  /** Marketplace / fulfilled-by badge near the offer. */
  marketplaceBadge: '[data-testid="marketplace-badge"], .marketplace-badge, [data-testid="sold-by"]',
  /** "Was $X" / "Reg $X" / "Comp. Value: $X" regular price next to the sale price. */
  reference: [
    '[data-testid="price-block-regular-price"] [data-lu-target="comp_value"]',
    '[data-testid="price-block-regular-price"]',
    ".pricing-price__regular-price",
    '[data-testid="regular-price"]',
    ".pricing-price__savings-regular-price",
  ],
  /** Customer price fallbacks when JSON-LD is absent or lacks offers. */
  price: [
    '[data-testid="price-block-customer-price"] .sr-only',
    ".priceView-customer-price > span:first-child",
    '[data-testid="customer-price"] span',
    ".priceView-hero-price span",
  ],
  /** New-format PDP add-to-cart button; presence implies the item is sellable. */
  addToCart: '[data-testid^="pdp-add-to-cart-"]',
} as const;
