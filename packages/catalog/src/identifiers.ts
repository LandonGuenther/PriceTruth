/** Identifier kinds the catalog identity engine understands. */
export type IdentifierKind =
  "GTIN" | "UPC" | "EAN" | "MPN" | "ASIN" | "BESTBUY_SKU" | "MANUFACTURER_MODEL";

/** GTIN-family kinds: all normalize to a 14-digit GTIN for comparison. */
export const GTIN_FAMILY: ReadonlySet<IdentifierKind> = new Set(["GTIN", "UPC", "EAN"]);
export const MODEL_FAMILY: ReadonlySet<IdentifierKind> = new Set(["MPN", "MANUFACTURER_MODEL"]);

export interface NormalizedIdentifier {
  type: IdentifierKind;
  /** Normalized comparison form (see normalizeIdentifier). */
  value: string;
  /** Passed format + check-digit validation. */
  valid: boolean;
}

export interface NormalizeResult {
  normalized: string;
  valid: boolean;
  reason?: string;
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * GS1 mod-10 check digit. Digits are 1-indexed from the left, the check digit
 * is the last; a data digit at distance d from the check position has weight 3
 * when d is odd, else 1.
 */
export function gtinCheckDigitValid(digits: string): boolean {
  const n = digits.length;
  if (!GTIN_LENGTHS.has(n) || !/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    const distance = n - 1 - i; // digits[i] is at position i+1; check at n
    const weight = distance % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits[n - 1]);
}

function normalizeGtin(raw: string): NormalizeResult {
  const digits = raw.replace(/\D/g, "");
  if (!GTIN_LENGTHS.has(digits.length)) {
    return { normalized: digits, valid: false, reason: "gtin_bad_length" };
  }
  // normalized form is defined even when the check digit fails so that two
  // identical-but-invalid values can still be compared (REVIEW tier).
  const normalized = digits.padStart(14, "0");
  if (!gtinCheckDigitValid(digits)) {
    return { normalized, valid: false, reason: "gtin_bad_check_digit" };
  }
  return { normalized, valid: true };
}

const WS = /\s+/g;

/**
 * Normalize an identifier for storage/comparison. `normalized` is always
 * defined for usable comparisons; `valid` is the strict format check.
 */
export function normalizeIdentifier(type: IdentifierKind, raw: string): NormalizeResult {
  switch (type) {
    case "GTIN":
    case "UPC":
    case "EAN":
      return normalizeGtin(raw);
    case "ASIN": {
      const v = raw.trim().toUpperCase();
      return /^[A-Z0-9]{10}$/.test(v)
        ? { normalized: v, valid: true }
        : { normalized: v, valid: false, reason: "asin_bad_format" };
    }
    case "BESTBUY_SKU": {
      const v = raw.trim();
      return /^\d{1,12}$/.test(v)
        ? { normalized: v, valid: true }
        : { normalized: v, valid: false, reason: "bestbuy_sku_bad_format" };
    }
    case "MPN":
    case "MANUFACTURER_MODEL": {
      const v = raw.trim().replace(WS, " ").toUpperCase();
      return v.length >= 2 && v.length <= 100
        ? { normalized: v, valid: true }
        : { normalized: v, valid: false, reason: "model_bad_length" };
    }
  }
}

/**
 * Model-number match key: normalized model string with separators removed, so
 * "WH-1000XM6" == "WH1000XM6" == "WH 1000 XM6". ProductIdentifier rows for
 * MPN/MANUFACTURER_MODEL store this as their `value`.
 */
export function mpnMatchKey(normalized: string): string {
  return normalized.replace(/[-_/ .]/g, "");
}

const BRAND_SUFFIXES = /\b(inc|llc|ltd|corp)\b\.?$/;

export function normalizeBrand(s: string): string {
  const v = s.trim().toLowerCase().replace(WS, " ").replace(BRAND_SUFFIXES, "").trim();
  return v;
}

export type Condition = "NEW" | "REFURBISHED" | "USED" | "UNKNOWN";

const CONDITION_TOKENS: Array<[RegExp, Exclude<Condition, "UNKNOWN">]> = [
  [/\bcertified[ -]refurbished\b/i, "REFURBISHED"],
  [/\brefurbished\b/i, "REFURBISHED"],
  [/\brenewed\b/i, "REFURBISHED"],
  [/\bpre[ -]owned\b/i, "USED"],
  [/\bused\b/i, "USED"],
  [/\bopen[ -]box\b/i, "USED"],
  [/\b(brand[ -])?new\b/i, "NEW"],
];

/**
 * Best-effort condition from a title; UNKNOWN when no token matches. The
 * negative tokens are checked before "new" so "Certified Refurbished, like new"
 * resolves to REFURBISHED.
 */
export function detectCondition(title: string): Condition {
  for (const [re, condition] of CONDITION_TOKENS) {
    if (re.test(title)) return condition;
  }
  return "UNKNOWN";
}
