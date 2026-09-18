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
  /**
   * Buy-box containers that may legitimately hold the product's own price.
   * The split-price fallback only searches inside one of these; the first
   * container that yields a price wins.
   */
  priceContainers: [
    "#corePriceDisplay_desktop_feature_div",
    "#corePrice_feature_div",
    "#apex_desktop",
    "#corePrice_desktop",
    "#buybox",
    "#desktop_buybox",
  ],
  /** Split-price fallback: whole and fractional parts rendered separately. */
  priceWhole: ".a-price-whole",
  priceFraction: ".a-price-fraction",
  /** Per-unit price blocks ("$0.27 / count") - never the product's price. */
  unitPriceContainers:
    ".apex-priceperunit-value, .pricePerUnit, #pricePerUnit, [class*='priceperunit' i], [class*='PricePerUnit'], [id*='pricePerUnit']",
  /** Strikethrough / basis price hosts - never adopt as current cash price. */
  strikethroughContainers: ".basisPrice, .a-text-strike, #listPrice, [data-a-strike='true']",
  /** Coupon widgets whose "$X" is savings, not the product price. */
  couponContainers:
    "#vpcButton, #promoPriceBlockMessage_feature_div, [id*='coupon' i], [class*='coupon' i], .promoPriceBlockMessage",
  /** Shipping / delivery fee hosts. */
  shippingContainers:
    "#deliveryBlockMessage, #mir-layout-DELIVERY_BLOCK, [id*='shippingMessage' i], [data-csa-c-delivery-price], .shipping-message",
  /** Used / renewed / marketplace offer hosts (not the new buy-box). */
  usedOfferContainers:
    "#usedBuySection, #olpLinkWidget_feature_div, #buybox-accordion #usedAccordionRow, [id*='usedBuy' i], [data-asin-condition-code]",
  /** Subscribe & Save / recurring price hosts. */
  snsContainers:
    "#snsAccordionRow, #subscribeAccordion, #sns-base-price, #sns-tiered-price, [id^='sns-'], [id*='sns' i][class*='price' i], .snsPriceBlock, .apex-pricetopay-accessibility-label",
  /**
   * Elements Amazon hides from the rendered page (display:none etc.) - their
   * prices must never be adopted (e.g. the hidden SnS tier block).
   */
  hiddenContainers:
    ".aok-hidden, [hidden], [aria-hidden='true'], [style*='display:none'], [style*='display: none']",
  /** Sponsored / cross-sell carousels (in addition to foreign-ASIN checks). */
  sponsoredContainers:
    "[data-component-type='sp-sponsored-result'], .AdHolder, #sponsoredProducts2_feature_div, #sp_detail, .sp_desktop_sponsored_label",
  /** Page regions whose text is checked for hidden-price messaging. */
  hiddenPriceRegions: "#dp, #centerCol, #ppd",
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

/**
 * Copy Amazon shows instead of a price when the product's price is gated
 * behind add-to-cart ("To see our price, add this item to your cart.").
 */
export const HIDDEN_PRICE_TEXT =
  /see (?:our )?price in cart|add (?:this item )?to (?:your )?cart to see (?:our )?price|price (?:is )?unavailable|see (?:our )?price[^.]*cart|see product details[^.]*cart/i;

/** Text local to a price node that marks it as a Subscribe & Save price. */
export const SNS_CTX = /subscribe\s*&\s*save|subscribe and save|percent savings|with \d+% savings/i;
