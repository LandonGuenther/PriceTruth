import { useEffect, useState } from "react";
import type { TabState } from "../messages.js";
import { tabStateKey } from "../messages.js";

/** Minimal chrome surface the panel needs — injectable for tests. */
export interface ChromeLike {
  tabs: {
    query(info: { active: boolean; lastFocusedWindow: boolean }): Promise<{ id?: number }[]>;
    onActivated: { addListener(cb: () => void): void; removeListener(cb: () => void): void };
  };
  storage: {
    session: {
      get(key: string): Promise<Record<string, TabState>>;
      onChanged: {
        addListener(
          cb: (changes: Record<string, { newValue?: TabState }>, area: string) => void,
        ): void;
        removeListener(
          cb: (changes: Record<string, { newValue?: TabState }>, area: string) => void,
        ): void;
      };
    };
  };
}

async function activeTabId(chromeApi: ChromeLike): Promise<number | undefined> {
  // tab.id is available without the "tabs" permission; we never read tab.url.
  const tabs = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0]?.id;
}

export function useTabState(chromeApi: ChromeLike = chrome as unknown as ChromeLike): {
  tabId: number | undefined;
  state: TabState;
} {
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [state, setState] = useState<TabState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const id = await activeTabId(chromeApi);
      if (cancelled) return;
      setTabId(id);
      if (id === undefined) {
        setState({ status: "idle" });
        return;
      }
      const stored = await chromeApi.storage.session.get(tabStateKey(id));
      if (!cancelled) setState(stored[tabStateKey(id)] ?? { status: "idle" });
    };
    void refresh();

    const onActivated = () => void refresh();
    const onChanged = (changes: Record<string, { newValue?: TabState }>, area: string) => {
      if (area !== "session" || tabId === undefined) return;
      const change = changes[tabStateKey(tabId)];
      if (change) setState(change.newValue ?? { status: "idle" });
    };
    chromeApi.tabs.onActivated.addListener(onActivated);
    chromeApi.storage.session.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chromeApi.tabs.onActivated.removeListener(onActivated);
      chromeApi.storage.session.onChanged.removeListener(onChanged);
    };
  }, [chromeApi, tabId]);

  return { tabId, state };
}
