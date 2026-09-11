import { findAdapter, type ExtractionMeta } from "@pricetruth/retailer-adapters";
import { retailerForHostname } from "@pricetruth/shared";
import type { ContentToBackground, ExtractionMeta as MessageExtractionMeta } from "../messages.js";

export interface ObserverDeps {
  getUrl: () => URL;
  getDocument: () => Document;
  send: (msg: ContentToBackground) => void;
  now: () => Date;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  /** Subscribe to DOM mutations; must call the callback (already) debounced or not - we debounce. */
  observeDomMutations: (cb: () => void) => () => void;
}

const URL_POLL_MS = 1000;
const MUTATION_DEBOUNCE_MS = 1500;
const LOCAL_DEDUPE_MS = 10 * 60 * 1000;

/** Map adapter ExtractionMeta onto the content→background message shape. */
export function toMessageExtraction(meta?: ExtractionMeta): MessageExtractionMeta | undefined {
  if (!meta) return undefined;
  return {
    adapterVersion: meta.adapterVersion,
    identityMethod: meta.identityMethod,
    priceMethod: meta.priceMethod,
    referenceMethod: meta.referenceMethod,
    identityConfidence: meta.identityConfidence,
    priceConfidence: meta.priceConfidence,
    referenceConfidence: meta.referenceConfidence,
    warnings: meta.warnings,
  };
}

/**
 * Extraction loop for the content script. Re-extracts when the URL changes
 * (retailer sites use pushState for variant switches) or when the DOM mutates
 * (debounced), but only re-sends when the extracted result actually differs,
 * and never more than one send per identical result within 10 minutes.
 *
 * Ambiguous prices are reported as pt/extraction-failed and never submitted as
 * observations.
 */
export function startObserver(deps: ObserverDeps): { stop: () => void } {
  let lastUrl = deps.getUrl().href;
  let lastSignature: string | null = null;
  let lastSent: { signature: string; at: number } | null = null;
  const failedUrls = new Set<string>();
  let debounceTimer: unknown = null;

  const onIdentityChange = (previousHref: string, nextHref: string): void => {
    failedUrls.delete(previousHref);
    failedUrls.delete(nextHref);
    lastSignature = null;
  };

  const runOnce = (): void => {
    const url = deps.getUrl();
    const doc = deps.getDocument();
    const now = deps.now();

    const adapter = findAdapter(url);
    if (!adapter) {
      // Content script only runs on supported retailer hosts: a supported
      // hostname without a product-page match means the user left the product
      // page. Report it once per URL so the panel can show "unsupported".
      const retailer = retailerForHostname(url.hostname);
      if (retailer && !failedUrls.has(url.href)) {
        failedUrls.add(url.href);
        deps.send({
          type: "pt/extraction-failed",
          retailer,
          reason: "not_product_page",
          url: url.href,
          warnings: [],
        });
      }
      return;
    }

    const result = adapter.extract(doc, url, now);
    const extraction = toMessageExtraction(result.meta);
    if (!result.ok) {
      if (!failedUrls.has(url.href)) {
        failedUrls.add(url.href);
        deps.send({
          type: "pt/extraction-failed",
          retailer: adapter.retailer,
          reason: result.reason,
          url: url.href,
          warnings: result.warnings,
          extraction,
        });
      }
      return;
    }

    const o = result.observation;
    const signature = JSON.stringify([o.externalId, o.priceCents, o.referencePriceCents ?? null]);
    if (signature === lastSignature) return;
    if (
      lastSent &&
      lastSent.signature === signature &&
      now.getTime() - lastSent.at < LOCAL_DEDUPE_MS
    ) {
      lastSignature = signature;
      return;
    }
    lastSignature = signature;
    lastSent = { signature, at: now.getTime() };
    deps.send({ type: "pt/observation", observation: o, extraction });
  };

  const interval = deps.setInterval(() => {
    const href = deps.getUrl().href;
    if (href !== lastUrl) {
      onIdentityChange(lastUrl, href);
      lastUrl = href;
      runOnce();
    }
  }, URL_POLL_MS);

  const stopObserving = deps.observeDomMutations(() => {
    if (debounceTimer) return;
    debounceTimer = deps.setTimeout(() => {
      debounceTimer = null;
      runOnce();
    }, MUTATION_DEBOUNCE_MS);
  });

  runOnce(); // initial extraction

  return {
    stop: () => {
      deps.clearInterval(interval);
      stopObserving();
    },
  };
}
