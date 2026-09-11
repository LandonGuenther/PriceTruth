/**
 * Parse a human-readable price string into integer cents using string
 * manipulation only (no float multiplication). Returns null for empty,
 * invalid, or negative input.
 */
export function parsePriceToCents(text: string, _currency?: string): number | null {
  if (typeof text !== "string") return null;

  // Normalize: strip whitespace incl. non-breaking spaces, currency symbols and letters.
  const cleaned = text
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/[A-Za-z$€£¥]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");

  if (cleaned.length === 0) return null;
  if (cleaned.startsWith("-") || cleaned.includes("-")) return null;

  // Allow a single trailing decimal point ("1299." → "1299").
  const normalized = cleaned.endsWith(".") ? cleaned.slice(0, -1) : cleaned;

  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const dollars = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");

  const cents = Number(dollars) * 100 + Number(fraction === "" ? "0" : fraction);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/** Format integer cents as a localized currency string, e.g. "$1,299.99". */
export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}
