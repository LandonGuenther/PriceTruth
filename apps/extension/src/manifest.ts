import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@pricetruth/shared";

/**
 * Manifest template. `scripts/write-manifest.ts` renders this to
 * dist/manifest.json, substituting the version and API origin.
 *
 * Permissions are intentionally minimal (see docs/EXTENSION.md):
 * - "sidePanel" — open the analysis panel.
 * - "storage" — chrome.storage.session holds per-tab state (never persisted).
 * Retailer page access comes only from content_scripts.matches; the sole
 * host_permission is the PriceTruth API itself.
 */
export function buildManifest(version: string, apiOrigin: string) {
  return {
    manifest_version: 3,
    name: PRODUCT_NAME,
    description: PRODUCT_TAGLINE,
    version,
    minimum_chrome_version: "114",
    permissions: ["sidePanel", "storage"],
    host_permissions: [`${apiOrigin}/*`],
    content_scripts: [
      {
        matches: [
          "https://www.amazon.com/*",
          "https://amazon.com/*",
          "https://smile.amazon.com/*",
          "https://www.bestbuy.com/*",
        ],
        js: ["content.js"],
        run_at: "document_idle",
      },
    ],
    background: { service_worker: "service-worker.js", type: "module" },
    side_panel: { default_path: "sidepanel.html" },
    action: {
      default_title: PRODUCT_NAME,
      default_icon: {
        "16": "icons/icon16.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png",
      },
    },
    icons: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  };
}
