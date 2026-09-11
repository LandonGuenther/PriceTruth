/**
 * Action popup: open the side panel, then close.
 *
 * Chrome's `setPanelBehavior({ openPanelOnActionClick })` and
 * `action.onClicked` + `sidePanel.open` are both flaky when the MV3 service
 * worker is a large ES module (import failure / kill-before-register → click
 * does nothing). Opening from this popup runs in a real user-gesture page
 * context and is the reliable path.
 */
async function openSidePanel(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) {
    await chrome.sidePanel.open({ tabId: tab.id });
    return;
  }
  if (tab?.windowId != null) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  }
  throw new Error("No active tab to attach the side panel to");
}

void (async () => {
  try {
    await openSidePanel();
    window.close();
  } catch {
    // Keep the popup open with an error so a failed click is visible instead
    // of "nothing happened".
    document.body.style.cssText =
      "margin:12px;width:260px;font:13px/1.4 system-ui,sans-serif;color:#111";
    document.body.textContent =
      "PriceTruth could not open the side panel. Use Chrome 114+ and click again from a normal tab (not chrome:// pages).";
  }
})();
