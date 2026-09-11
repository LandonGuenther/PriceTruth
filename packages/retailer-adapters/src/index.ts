import { amazonAdapter } from "./amazon/index.js";
import { bestbuyAdapter } from "./bestbuy/index.js";
import type { RetailerAdapter } from "./types.js";

export * from "./types.js";
export { amazonAdapter } from "./amazon/index.js";
export { bestbuyAdapter } from "./bestbuy/index.js";
export { AMAZON_SELECTORS } from "./amazon/selectors.js";
export { BESTBUY_SELECTORS } from "./bestbuy/selectors.js";

/** Adapter/schema version emitted as `extractorVersion`; bump on selector changes. */
export const ADAPTER_VERSION = "1.1.0";

export const adapters: RetailerAdapter[] = [amazonAdapter, bestbuyAdapter];

export function findAdapter(url: URL): RetailerAdapter | null {
  return adapters.find((a) => a.matchesUrl(url)) ?? null;
}
