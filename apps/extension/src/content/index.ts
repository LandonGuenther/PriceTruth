/**
 * PriceTruth content script - privacy scope:
 * reads ONLY product metadata via the retailer-adapter selectors (title,
 * prices, identifiers, availability). It never writes to the DOM, never reads
 * cookies or form fields, and sends only RetailerObservation objects (or an
 * extraction-failure notice) to the extension's own service worker. No page
 * content, browsing history, or personal data leaves the extension.
 */
import { startObserver } from "./observer.js";
import type { BackgroundToContent, ContentPong, ContentToBackground } from "../messages.js";

/** Prefer mutations that touch likely price/title/identity containers. */
const RELEVANT_MUTATION =
  /price|title|corePrice|availability|ASIN|productTitle|price-block|twister|apex_|buybox|customer-price|comp_value|sku/i;

export function mutationLooksRelevant(target: EventTarget | null): boolean {
  let node: Node | null = target as Node | null;
  if (node && node.nodeType === 3) node = node.parentElement;
  for (let el = node as Element | null; el; el = el.parentElement) {
    const id = el.id ?? "";
    const cls = typeof el.className === "string" ? el.className : String(el.className ?? "");
    const testid = el.getAttribute?.("data-testid") ?? "";
    if (RELEVANT_MUTATION.test(`${id} ${cls} ${testid}`)) return true;
    if (el.tagName === "BODY" || el.tagName === "HTML") break;
  }
  // childList additions under body often rebuild whole subtrees - allow those.
  return false;
}

// Service-worker liveness check: answer pt/ping synchronously with pt/pong.
chrome.runtime.onMessage.addListener(
  (msg: BackgroundToContent, _sender, sendResponse: (r: ContentPong) => void) => {
    if (msg.type === "pt/ping") {
      sendResponse({ type: "pt/pong" });
    }
  },
);

startObserver({
  getUrl: () => new URL(window.location.href),
  getDocument: () => document,
  send: (msg: ContentToBackground) => void chrome.runtime.sendMessage(msg),
  now: () => new Date(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  observeDomMutations: (cb) => {
    const mo = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        if (mutationLooksRelevant(m.target)) return true;
        for (const n of m.addedNodes) {
          if (mutationLooksRelevant(n)) return true;
        }
        return false;
      });
      if (relevant) cb();
    });
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "data-asin", "data-sku-id", "data-testid", "style"],
    });
    return () => mo.disconnect();
  },
});
