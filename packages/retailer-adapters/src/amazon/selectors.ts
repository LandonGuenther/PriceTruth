/**
 * Amazon DOM selectors. Hand-maintained; every selector must be exercised by at
 * least one fixture under fixtures/amazon/.
 */
export const AMAZON_SELECTORS = {
  /** Main product title heading. */
  title: "#productTitle",
  /** Hidden ASIN input present on product pages. */
  asinInput: "input#ASIN",
  /** #dp container carrying data-asin. */
  dpDataAsin: "#dp[data-asin]",
  /** Any element carrying a data-asin attribute (fallback). */
  anyDataAsin: "[data-asin]",
  /** Detail bullets list items - scanned for the "ASIN" label. */
  detailBullets: "#detailBullets li, #detailBullets_feature_div li",
  /** Embedded JSON-LD blocks; scanned for @type "Product" offers.price. */
  jsonLd: 'script[type="application/ld+json"]',
  /**
   * Buy-box / core price containers. Price queries MUST be scoped to these
   * roots - never take the first global `.a-price` / `.a-price-whole`.
   */
  priceRoots: [
    "#corePriceDisplay_desktop_feature_div",
    "#corePrice_feature_div",
    "#apex_desktop",
    "#corePrice_desktop",
  ],
  /**
   * Within a price root, prefer `.priceToPay .a-offscreen`, then `.a-price
   * .a-offscreen`. Legacy priceblock ids are also accepted as whole-document
   * (but non-global-class) fallbacks.
   */
  priceToPayOffscreen: ".priceToPay .a-offscreen",
  priceOffscreen: ".a-price .a-offscreen",
  legacyPrice: ["#priceblock_ourprice", "#priceblock_dealprice"],
  /** Split-price parts - must be resolved under the same `.a-price` ancestor. */
  priceWhole: ".a-price-whole",
  priceFraction: ".a-price-fraction",
  aPrice: ".a-price",
  /**
   * Reference ("List Price" / "Typical price") candidates, in priority order.
   * `.basisPrice` holds the strike-through basis price in the core price block.
   */
  reference: [
    "#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen",
    "#corePrice_feature_div .basisPrice .a-offscreen",
    "#listPrice",
    "#priceblock_ourprice ~ .a-text-strike",
  ],
  /** "Visit the X Store" / "Brand: X" byline. */
  byline: "#bylineInfo",
  /** Product overview table rows (Brand / Model Name / Item model number). */
  overviewRows: "#productOverview_feature_div tr",
  /** Detail bullets feature rows (Item model number, etc.). */
  detailRows: "#detailBullets_feature_div li",
  /** Availability line ("In Stock", "Currently unavailable", ...). */
  availability: "#availability",
  /** Twister/variation rows ("Size", "Color", ... pickers). */
  variationRow: "[id^='variation_']",
  /** The selected-value text inside a variation row. */
  variationValue: "[id^='variation_'] .selection",
  /** Variation row labels ("Size", "Color", ...). */
  variationLabel: "label.a-form-label",
} as const;
