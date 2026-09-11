import { PRODUCT_NAME, type RetailerObservation } from "@pricetruth/shared";
import type { RuntimeMessage, TabState } from "../messages.js";
import { tabStateKey } from "../messages.js";
import type { ApiClient, IngestResponse } from "./api.js";

export interface HandlerStorage {
  get(key: string): Promise<Record<string, TabState>>;
  set(values: Record<string, TabState>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface HandlerDeps {
  api: Pick<ApiClient, "postObservation" | "getAnalysis" | "getHistory">;
  storage: HandlerStorage;
  now: () => Date;
  /** Resolves true if the content script on the tab answers pt/ping with pt/pong. */
  ping: (tabId: number) => Promise<boolean>;
  /** setTimeout equivalent (injected for tests). */
  schedule: (fn: () => void, ms: number) => void;
}

/** Delay before pinging after a navigation starts — lets the new page's content script load. */
export const NAVIGATION_PING_DELAY_MS = 1500;

const unreachableMessage = `Could not reach the ${PRODUCT_NAME} service. Check that it is running and try again.`;

async function setState(deps: HandlerDeps, tabId: number, state: TabState): Promise<void> {
  await deps.storage.set({ [tabStateKey(tabId)]: state });
}

async function getState(deps: HandlerDeps, tabId: number): Promise<TabState | undefined> {
  const all = await deps.storage.get(tabStateKey(tabId));
  return all[tabStateKey(tabId)];
}

async function runObservation(
  deps: HandlerDeps,
  tabId: number,
  observation: RetailerObservation,
): Promise<void> {
  await setState(deps, tabId, { status: "loading", observation });
  try {
    const ingest: IngestResponse = await deps.api.postObservation(observation);
    const [analysis, history] = await Promise.all([
      deps.api.getAnalysis(observation.retailer, observation.externalId),
      deps.api.getHistory(observation.retailer, observation.externalId),
    ]);
    await setState(deps, tabId, {
      status: "ready",
      observation,
      analysis,
      history,
      ingest: { accepted: ingest.accepted, duplicate: ingest.duplicate },
      updatedAt: deps.now().toISOString(),
    });
  } catch {
    await setState(deps, tabId, {
      status: "error",
      observation,
      message: unreachableMessage,
      updatedAt: deps.now().toISOString(),
    });
  }
}

/**
 * Called on tabs.onUpdated status "loading". We cannot read changeInfo.url
 * (that needs the "tabs" permission, which we refuse for privacy), so after a
 * short delay we ping the content script: no answer means the tab left a
 * supported host (or is still loading) → reset to idle. A live supported page
 * refreshes state itself via the observer. Amazon emits ghost "loading" events
 * after page load — the ping prevents those from wiping ready state, and an
 * in-flight ingest (state "loading") is never touched.
 */
export async function handleNavigationStart(tabId: number, deps: HandlerDeps): Promise<void> {
  await new Promise<void>((resolve) => deps.schedule(resolve, NAVIGATION_PING_DELAY_MS));
  const alive = await deps.ping(tabId);
  const prev = await getState(deps, tabId);
  if (prev?.status === "loading") return;
  if (!alive) await setState(deps, tabId, { status: "idle" });
}

export async function handleMessage(
  msg: RuntimeMessage,
  tabId: number | undefined,
  deps: HandlerDeps,
): Promise<void> {
  if (msg.type === "pt/observation" && tabId !== undefined) {
    await runObservation(deps, tabId, msg.observation);
    return;
  }
  if (msg.type === "pt/extraction-failed" && tabId !== undefined) {
    await setState(deps, tabId, {
      status: "unsupported",
      retailer: msg.retailer,
      reason: msg.reason,
    });
    return;
  }
  if (msg.type === "pt/retry") {
    const state = await getState(deps, msg.tabId);
    const observation =
      state && (state.status === "error" || state.status === "ready" || state.status === "loading")
        ? state.observation
        : undefined;
    if (observation) await runObservation(deps, msg.tabId, observation);
  }
}
