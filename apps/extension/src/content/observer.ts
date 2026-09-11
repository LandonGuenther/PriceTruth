import { findAdapter } from "@pricetruth/retailer-adapters";
import type { ContentToBackground } from "../messages.js";

export interface ObserverDeps {
  getUrl: () => URL;
  getDocument: () => Document;
  send: (msg: ContentToBackground) => void;
  now: () => Date;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  /** Subscribe to DOM mutations; must call the callback (already) debounced or not — we debounce. */
  observeDomMutations: (cb: () => void) => () => void;
}

const URL_POLL_MS = 1000;
const MUTATION_DEBOUNCE_MS = 1500;
const LOCAL_DEDUPE_MS = 10 * 60 * 1000;

/**
 * Extraction loop for the content script. Re-extracts when the URL changes
 * (retailer sites use pushState for variant switches) or when the DOM mutates
 * (debounced), but only re-sends when the extracted result actually differs,
 * and never more than one send per identical result within 10 minutes.
 */
export function startObserver(deps: ObserverDeps): { stop: () => void } {
  let lastUrl = deps.getUrl().href;
  let lastSignature: string | null = null;
  let lastSent: { signature: string; at: number } | null = null;
  const failedUrls = new Set<string>();
  let debounceTimer: unknown = null;

  const runOnce = (): void => {
    const url = deps.getUrl();
    const doc = deps.getDocument();
    const now = deps.now();

    const adapter = findAdapter(url);
    if (!adapter) return; // not a retailer page we support — stay silent

    const result = adapter.extract(doc, url, now);
    if (!result.ok) {
      if (!failedUrls.has(url.href)) {
        failedUrls.add(url.href);
        deps.send({
          type: "pt/extraction-failed",
          retailer: adapter.retailer,
          reason: result.reason,
          url: url.href,
          warnings: result.warnings,
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
    deps.send({ type: "pt/observation", observation: o });
  };

  const interval = deps.setInterval(() => {
    const href = deps.getUrl().href;
    if (href !== lastUrl) {
      lastUrl = href;
      lastSignature = null; // new page → re-evaluate
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
