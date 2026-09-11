export type RetailerId = "amazon" | "bestbuy";

export interface RetailerInfo {
  id: RetailerId;
  displayName: string;
  identifierLabel: "ASIN" | "SKU";
  hostnames: string[];
}

/** Map a hostname to a supported retailer, or null. Subdomains of a registered hostname count. */
export function retailerForHostname(hostname: string): RetailerId | null {
  const host = hostname.toLowerCase();
  for (const r of Object.values(RETAILERS)) {
    if (r.hostnames.some((h) => host === h || host.endsWith(`.${h}`))) return r.id;
  }
  return null;
}

export const RETAILERS: Record<RetailerId, RetailerInfo> = {
  amazon: {
    id: "amazon",
    displayName: "Amazon",
    identifierLabel: "ASIN",
    hostnames: ["www.amazon.com", "amazon.com", "smile.amazon.com"],
  },
  bestbuy: {
    id: "bestbuy",
    displayName: "Best Buy",
    identifierLabel: "SKU",
    hostnames: ["www.bestbuy.com", "bestbuy.com"],
  },
};
