/**
 * PriceTruth content script — privacy scope:
 * reads ONLY product metadata via the retailer-adapter selectors (title,
 * prices, identifiers, availability). It never writes to the DOM, never reads
 * cookies or form fields, and sends only RetailerObservation objects (or an
 * extraction-failure notice) to the extension's own service worker. No page
 * content, browsing history, or personal data leaves the extension.
 */
import { startObserver } from "./observer.js";
import type { ContentToBackground } from "../messages.js";

startObserver({
  getUrl: () => new URL(window.location.href),
  getDocument: () => document,
  send: (msg: ContentToBackground) => void chrome.runtime.sendMessage(msg),
  now: () => new Date(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  observeDomMutations: (cb) => {
    const mo = new MutationObserver(cb);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  },
});
