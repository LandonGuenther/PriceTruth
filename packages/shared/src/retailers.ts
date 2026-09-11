export type RetailerId = "amazon" | "bestbuy";

export interface RetailerInfo {
  id: RetailerId;
  displayName: string;
  identifierLabel: "ASIN" | "SKU";
  hostnames: string[];
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
