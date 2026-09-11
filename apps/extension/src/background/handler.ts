import { PRODUCT_NAME, type RetailerObservation } from "@pricetruth/shared";
import type { RuntimeMessage, TabState } from "../messages.js";
import { DIAGNOSTICS_KEY, tabStateKey } from "../messages.js";
import {
  ApiError,
  ApiMalformedError,
  ApiTimeoutError,
  ApiUnsupportedVersionError,
  type ApiClient,
  type IngestResponse,
} from "./api.js";

export interface HandlerStorage {
  get(key: string): Promise<Record<string, TabState | boolean>>;
  set(values: Record<string, TabState | boolean>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface HandlerDeps {
  api: Pick<ApiClient, "postObservation" | "getAnalysis" | "getHistory">;
  storage: HandlerStorage;
  now: () => Date;
  /** Resolves true if the content script on the tab answers pt/ping with pt/pong. */
  ping: (tabId: number) => Promise<boolean>;
  /** setTimeout equivalent (injected for tests). Must return a cancellable handle. */
  schedule: (fn: () => void, ms: number) => unknown;
  /** Optional clearTimeout; required to cancel stale navigation pings. */
  cancelSchedule?: (handle: unknown) => void;
}

/** Delay before pinging after a navigation starts - lets the new page's content script load. */
export const NAVIGATION_PING_DELAY_MS = 1500;

const unreachableMessage = `Could not reach the ${PRODUCT_NAME} service. Check that it is running and try again.`;
const timeoutMessage = `The ${PRODUCT_NAME} service took too long to respond. Try again in a moment.`;
const apiMessage = `The ${PRODUCT_NAME} service returned an error. Try again in a moment.`;
const malformedMessage = `The ${PRODUCT_NAME} service returned an unexpected response. Try updating the extension.`;
const unsupportedMessage = `This extension is out of date for the ${PRODUCT_NAME} service. Please update the extension.`;
const ambiguousMessage = `${PRODUCT_NAME} found this product but could not confidently determine its current price. Nothing was recorded.`;

/** Per-tab monotonic generation - bumps on every new observation / retry / failure. */
const generations = new Map<number, number>();
/** Per-tab pending navigation wait (timer handle + resolve to unblock awaiters). */
const navWaits = new Map<number, { handle: unknown; resolve: () => void }>();
/** Per-tab ping epoch so overlapping navigation events don't clobber newer work. */
const navEpochs = new Map<number, number>();

export function peekGeneration(tabId: number): number {
  return generations.get(tabId) ?? 0;
}

export function resetHandlerEphemeralState(): void {
  generations.clear();
  for (const pending of navWaits.values()) pending.resolve();
  navWaits.clear();
  navEpochs.clear();
}

function nextGeneration(tabId: number): number {
  const g = (generations.get(tabId) ?? 0) + 1;
  generations.set(tabId, g);
  return g;
}

async function setState(deps: HandlerDeps, tabId: number, state: TabState): Promise<void> {
  await deps.storage.set({ [tabStateKey(tabId)]: state });
}

async function getState(deps: HandlerDeps, tabId: number): Promise<TabState | undefined> {
  const all = await deps.storage.get(tabStateKey(tabId));
  const v = all[tabStateKey(tabId)];
  if (v && typeof v === "object" && "status" in v) return v as TabState;
  return undefined;
}

function classifyError(err: unknown): {
  kind: "network" | "api" | "timeout" | "malformed" | "unsupported_version" | "unknown";
  message: string;
} {
  if (err instanceof ApiTimeoutError) return { kind: "timeout", message: timeoutMessage };
  if (err instanceof ApiUnsupportedVersionError) {
    return { kind: "unsupported_version", message: unsupportedMessage };
  }
  if (err instanceof ApiMalformedError) return { kind: "malformed", message: malformedMessage };
  if (err instanceof ApiError) return { kind: "api", message: apiMessage };
  if (err instanceof TypeError) return { kind: "network", message: unreachableMessage };
  return { kind: "unknown", message: unreachableMessage };
}

async function runObservation(
  deps: HandlerDeps,
  tabId: number,
  observation: RetailerObservation,
  warnings?: string[],
): Promise<void> {
  const generation = nextGeneration(tabId);
  await setState(deps, tabId, {
    status: "loading",
    observation,
    phase: "submitting",
    generation,
    warnings,
  });

  try {
    const ingest: IngestResponse = await deps.api.postObservation(observation);
    // A newer observation (or retry) started while we were posting - abandon.
    if (generations.get(tabId) !== generation) return;

    await setState(deps, tabId, {
      status: "loading",
      observation,
      phase: "analyzing",
      generation,
      warnings,
    });

    const [analysis, history] = await Promise.all([
      deps.api.getAnalysis(observation.retailer, observation.externalId),
      deps.api.getHistory(observation.retailer, observation.externalId),
    ]);
    if (generations.get(tabId) !== generation) return;

    await setState(deps, tabId, {
      status: "ready",
      observation,
      analysis,
      history,
      ingest: { accepted: ingest.accepted, duplicate: ingest.duplicate },
      updatedAt: deps.now().toISOString(),
      generation,
      warnings,
    });
  } catch (err) {
    if (generations.get(tabId) !== generation) return;
    const { kind, message } = classifyError(err);
    await setState(deps, tabId, {
      status: "error",
      observation,
      message,
      updatedAt: deps.now().toISOString(),
      kind,
      generation,
    });
  }
}

function cancelNavWait(tabId: number, deps: HandlerDeps): void {
  const pending = navWaits.get(tabId);
  if (!pending) return;
  deps.cancelSchedule?.(pending.handle);
  pending.resolve();
  navWaits.delete(tabId);
}

/**
 * Called on tabs.onUpdated status "loading". We cannot read changeInfo.url
 * (that needs the "tabs" permission, which we refuse for privacy), so after a
 * short delay we ping the content script: no answer means the tab left a
 * supported host (or is still loading) -> reset to idle. A live supported page
 * refreshes state itself via the observer. Amazon emits ghost "loading" events
 * after page load - the ping prevents those from wiping ready state, and an
 * in-flight ingest (state "loading") is never touched.
 *
 * Overlapping loading events cancel the prior timer so only the latest epoch
 * can reset state.
 */
export async function handleNavigationStart(tabId: number, deps: HandlerDeps): Promise<void> {
  cancelNavWait(tabId, deps);
  const epoch = (navEpochs.get(tabId) ?? 0) + 1;
  navEpochs.set(tabId, epoch);

  await new Promise<void>((resolve) => {
    const handle = deps.schedule(() => {
      const cur = navWaits.get(tabId);
      if (cur?.handle === handle) navWaits.delete(tabId);
      resolve();
    }, NAVIGATION_PING_DELAY_MS);
    navWaits.set(tabId, { handle, resolve });
  });

  if (navEpochs.get(tabId) !== epoch) return;

  const alive = await deps.ping(tabId);
  if (navEpochs.get(tabId) !== epoch) return;
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
    await runObservation(deps, tabId, msg.observation, msg.warnings);
    return;
  }

  if (msg.type === "pt/extraction-failed" && tabId !== undefined) {
    nextGeneration(tabId);
    if (msg.reason === "ambiguous_price") {
      await setState(deps, tabId, {
        status: "ambiguous",
        retailer: msg.retailer,
        url: msg.url,
        warnings: msg.warnings,
        message: ambiguousMessage,
      });
      return;
    }
    await setState(deps, tabId, {
      status: "unsupported",
      retailer: msg.retailer,
      reason: msg.reason,
      warnings: msg.warnings,
    });
    return;
  }

  if (msg.type === "pt/set-diagnostics") {
    await deps.storage.set({ [DIAGNOSTICS_KEY]: msg.enabled });
    return;
  }

  if (msg.type === "pt/retry") {
    const state = await getState(deps, msg.tabId);
    const observation =
      state &&
      (state.status === "error" || state.status === "ready" || state.status === "loading")
        ? state.observation
        : undefined;
    if (observation) {
      const warnings =
        state && (state.status === "ready" || state.status === "loading")
          ? state.warnings
          : undefined;
      await runObservation(deps, msg.tabId, observation, warnings);
    }
  }
}
