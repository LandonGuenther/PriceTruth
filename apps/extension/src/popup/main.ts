/**
 * Action popup entry.
 *
 * Prefer Chrome/Edge side panel when `chrome.sidePanel.open` works. Opera
 * (and some Chromium forks) lack or break that API - fall back to rendering
 * the same panel UI inside this popup so the toolbar icon still works.
 */

function sidePanelApiAvailable(): boolean {
  return typeof chrome.sidePanel?.open === "function";
}

async function tryOpenSidePanel(): Promise<boolean> {
  if (!sidePanelApiAvailable()) return false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      await chrome.sidePanel.open({ tabId: tab.id });
      return true;
    }
    if (tab?.windowId != null) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function mountFallbackPanel(): Promise<void> {
  document.documentElement.classList.add("pt-popup-fallback");
  const root = document.getElementById("root");
  if (!root) throw new Error("PriceTruth popup root element missing");
  const { mountPanel } = await import("../sidepanel/mount.js");
  mountPanel(root);
}

void (async () => {
  if (await tryOpenSidePanel()) {
    window.close();
    return;
  }
  try {
    await mountFallbackPanel();
  } catch {
    document.documentElement.classList.add("pt-popup-fallback");
    document.body.style.cssText =
      "margin:12px;width:280px;font:13px/1.4 system-ui,sans-serif;color:#111";
    document.body.textContent =
      "PriceTruth could not open. Reload the extension on opera://extensions and try again from an Amazon or Best Buy product page.";
  }
})();
