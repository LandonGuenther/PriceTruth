import { API_BASE_URL } from "../config.js";
import type { RuntimeMessage, TabState } from "../messages.js";
import { tabStateKey } from "../messages.js";
import { ApiClient } from "./api.js";
import { handleMessage, handleNavigationStart, type HandlerStorage } from "./handler.js";

const storage: HandlerStorage = {
  get: (key) => chrome.storage.session.get(key) as Promise<Record<string, TabState>>,
  set: (values) => chrome.storage.session.set(values),
  remove: (key) => chrome.storage.session.remove(key),
};

// Wrap `fetch` - storing it bare and calling it later throws "Illegal invocation".
const api = new ApiClient(
  API_BASE_URL,
  (url, init) => fetch(url, init),
  chrome.runtime.getManifest().version,
);

const deps = {
  api,
  storage,
  now: () => new Date(),
  ping: async (tabId: number): Promise<boolean> => {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: "pt/ping" });
      return (r as { type?: string } | undefined)?.type === "pt/pong";
    } catch {
      return false;
    }
  },
  schedule: (fn: () => void, ms: number) => setTimeout(fn, ms),
  cancelSchedule: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Open the side panel on toolbar click.
 *
 * Prefer an explicit `action.onClicked` + `sidePanel.open` path over relying
 * solely on `setPanelBehavior({ openPanelOnActionClick })`. The behavior flag
 * is async and can be lost if the MV3 service worker is killed before the
 * promise settles, which presents as: toolbar icon (blue square) click does
 * nothing. `onClicked` runs on the user gesture and opens reliably.
 *
 * Do not also enable openPanelOnActionClick - Chrome will not fire onClicked
 * when that behavior is set.
 */
chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.windowId === "number") {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      // Side panel unavailable (policy / unsupported) - nothing else to do.
    });
  }
});

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  void handleMessage(msg, sender.tab?.id, deps);
  return false; // async work continues via storage; no response channel needed
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void storage.remove(tabStateKey(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // changeInfo.url is never populated without the "tabs" permission - reset
  // is ping-based instead (see handleNavigationStart).
  if (changeInfo.status === "loading") {
    void handleNavigationStart(tabId, deps);
  }
});
