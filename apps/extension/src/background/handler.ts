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
}

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
