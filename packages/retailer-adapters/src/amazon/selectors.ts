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
  /** Detail bullets list items — scanned for the "ASIN" label. */
  detailBullets: "#detailBullets li, #detailBullets_feature_div li",
  /**
   * Price candidates, in priority order. `.a-offscreen` spans carry the
   * screen-reader copy of a visually-split price ("$299.00").
   */
  price: [
    "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
    "#corePrice_feature_div .a-price .a-offscreen",
    "#apex_desktop .priceToPay .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "#corePrice_desktop .a-price .a-offscreen",
  ],
  /** Split-price fallback: whole and fractional parts rendered separately. */
  priceWhole: ".a-price-whole",
  priceFraction: ".a-price-fraction",
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
