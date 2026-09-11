import { parsePriceToCents } from "@pricetruth/shared";

/**
 * Extract the first "$…" currency amount from free text (e.g. "Comp. Value:
 * $274.99", "Was $399.99") without loosening the strict shared parser.
 */
export function extractFirstPrice(text: string): number | null {
  const match = text.replace(/\u00a0/g, " ").match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return match?.[1] ? parsePriceToCents(match[1]) : null;
}
