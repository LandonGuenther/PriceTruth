import { describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { tabStateKey, type TabState } from "../messages.js";
import { useTabState, type ChromeLike } from "./useTabState.js";

afterEach(cleanup);

function fakeChrome(initial: Record<string, TabState>) {
  const store = { ...initial };
  const changeListeners: Array<(changes: Record<string, { newValue?: TabState }>) => void> = [];
  const activatedListeners: Array<() => void> = [];
  const chrome: ChromeLike = {
    tabs: {
      query: async () => [{ id: 7 }],
      onActivated: {
        addListener: (cb) => activatedListeners.push(cb),
        removeListener: () => {},
      },
    },
    storage: {
      session: {
        get: async (key) => (store[key] ? { [key]: store[key]! } : {}),
        onChanged: {
          addListener: (cb) => changeListeners.push(cb),
          removeListener: () => {},
        },
      },
    },
  };
  // StorageArea.onChanged fires with a single `changes` argument  -  no area.
  const fireChange = (key: string, newValue: TabState) =>
    changeListeners.forEach((cb) => cb({ [key]: { newValue } }));
  return { chrome, store, fireChange };
}

function Harness({ chrome }: { chrome: ChromeLike }) {
  const { state } = useTabState(chrome);
  return <div data-testid="status">{state.status}</div>;
}

describe("useTabState", () => {
  it("reads initial state for the active tab", async () => {
    const { chrome } = fakeChrome({ [tabStateKey(7)]: { status: "idle" } });
    render(<Harness chrome={chrome} />);
    await act(async () => {});
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("re-renders when session storage changes for the active tab (single-arg listener)", async () => {
    const { chrome, store, fireChange } = fakeChrome({});
    render(<Harness chrome={chrome} />);
    await act(async () => {});
    expect(screen.getByTestId("status").textContent).toBe("idle");

    const ready = { status: "ready" } as TabState;
    store[tabStateKey(7)] = ready;
    await act(async () => {
      fireChange(tabStateKey(7), ready);
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");

    // changes for another tab are ignored
    await act(async () => {
      fireChange(tabStateKey(99), { status: "error", message: "x", updatedAt: "" });
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
  });
});
