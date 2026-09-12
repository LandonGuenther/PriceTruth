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
 *
 * The `key` field pins a stable extension id (hkpcfcjmogoaakoemandjkkdgnhpdejk) so staging/production
 * can set ALLOWED_EXTENSION_IDS. Only the public key is committed.
 */
export function buildManifest(version: string, apiOrigin: string) {
  return {
    manifest_version: 3,
    name: PRODUCT_NAME,
    description: PRODUCT_TAGLINE,
    version,
    // Public key only — stable unpacked/packed extension id: hkpcfcjmogoaakoemandjkkdgnhpdejk
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtRCZCu16G2p4ey1tm2+hY7SQkM79Dq4A2FuvI0JyEw1sUxa00ARY4JY+CRYoxCZqPkDSwo29Dgn+9S8TqFlXl5IxIQJeYtsJBSP4MhDf+JiXvYF7OdymfFQfDuvlwGTRuMfQWxBPWhCSLAyaZ8aAadTa/5FshsIgDq6nXtmxW9Nk0qYG1qdRLIsqzngiV275UI/7gQDeNbQpPV2RsRiGeLFpzVHxz6A086dlJ8P9LDpNjwiiSd0voiI3kA8mCVfJtLW8mgplIJgDXW5lFJbWVKimIlYh4l5xxrGZNthgbUDbYpzhpIuzlUjROc7Sj4x0MyV/t4YCwKWQFo3zvgRd7QIDAQAB",
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
      // Popup is the reliable toolbar-click → side panel path on MV3.
      // See src/popup/main.ts. Keep this instead of relying only on
      // setPanelBehavior / action.onClicked in the service worker.
      default_popup: "popup.html",
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
