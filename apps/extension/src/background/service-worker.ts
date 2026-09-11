import { API_BASE_URL } from "../config.js";
import type { RuntimeMessage, TabState } from "../messages.js";
import { tabStateKey } from "../messages.js";
import { ApiClient } from "./api.js";
import { handleMessage, type HandlerStorage } from "./handler.js";

const storage: HandlerStorage = {
  get: (key) => chrome.storage.session.get(key) as Promise<Record<string, TabState>>,
  set: (values) => chrome.storage.session.set(values),
  remove: (key) => chrome.storage.session.remove(key),
};

const api = new ApiClient(API_BASE_URL, fetch, chrome.runtime.getManifest().version);

const deps = { api, storage, now: () => new Date() };

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  void handleMessage(msg, sender.tab?.id, deps);
  return false; // async work continues via storage; no response channel needed
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void storage.remove(tabStateKey(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // New navigation clears state; the content script repopulates it on
    // supported product pages. Unsupported pages stay idle.
    void storage.set({ [tabStateKey(tabId)]: { status: "idle" } });
  }
});
