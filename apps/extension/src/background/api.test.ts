import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("ApiClient", () => {
  it("calls fetch unbound-safe: default impl calls globalThis.fetch with global this", async () => {
    const spy = vi.fn(function (this: unknown) {
      // Regression guard: a stored bare `fetch` is called with a non-global
      // `this` and throws "Illegal invocation" in Chrome.
      expect(this === undefined || this === globalThis).toBe(true);
      return Promise.resolve(new Response('{"ok":true}'));
    });
    vi.stubGlobal("fetch", spy);
    const client = new ApiClient("http://x");
    const res = await client.getAnalysis("amazon", "B0TESTASIN");
    expect(res).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws ApiError with status on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );
    const client = new ApiClient("http://x");
    await expect(client.getHistory("amazon", "B0TESTASIN")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
    await expect(client.getAnalysis("amazon", "B0TESTASIN")).rejects.toBeInstanceOf(ApiError);
  });
});
