import { describe, expect, it } from "vitest";
import { startObserver, type ObserverDeps } from "./observer.js";
import type { ContentToBackground } from "../messages.js";

const PDP = (asin: string, price = "$299.00", ref = "$499.00") => `
  <div id="dp" data-asin="${asin}">
    <span id="productTitle">Widget ${asin}</span>
    <div id="corePriceDisplay_desktop_feature_div">
      <span class="basisPrice"><span class="a-offscreen">${ref}</span></span>
      <span class="priceToPay"><span class="a-offscreen">${price}</span></span>
    </div>
    <div id="availability">In Stock</div>
  </div>`;

function makeDeps(initialUrl: string, initialHtml: string) {
  let url = new URL(initialUrl);
  let html = initialHtml;
  let time = new Date("2025-06-30T12:00:00Z").getTime();
  const sent: ContentToBackground[] = [];
  const intervalFns: Array<() => void> = [];
  const timeoutFns: Array<() => void> = [];
  let mutationCb: (() => void) | null = null;

  const deps: ObserverDeps = {
    getUrl: () => url,
    getDocument: () => new DOMParser().parseFromString(html, "text/html"),
    send: (m) => sent.push(m),
    now: () => new Date(time),
    setInterval: (fn) => (intervalFns.push(fn), intervalFns.length),
    clearInterval: () => {},
    setTimeout: (fn) => (timeoutFns.push(fn), timeoutFns.length),
    observeDomMutations: (cb) => ((mutationCb = cb), () => {}),
  };
  return {
    deps,
    sent,
    setUrl: (u: string) => (url = new URL(u)),
    setHtml: (h: string) => (html = h),
    tickInterval: () => intervalFns.forEach((f) => f()),
    mutate: () => mutationCb?.(),
    flushTimers: () => {
      const fns = [...timeoutFns];
      timeoutFns.length = 0;
      fns.forEach((f) => f());
    },
    advance: (ms: number) => (time += ms),
  };
}

const URL1 = "https://www.amazon.com/dp/B0TESTASIN";

describe("content observer", () => {
  it("sends one observation on bootstrap", () => {
    const d = makeDeps(URL1, PDP("B0TESTASIN"));
    startObserver(d.deps);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toMatchObject({
      type: "pt/observation",
      observation: { externalId: "B0TESTASIN", priceCents: 29900, referencePriceCents: 49900 },
    });
  });

  it("identical DOM churn does not resend", () => {
    const d = makeDeps(URL1, PDP("B0TESTASIN"));
    startObserver(d.deps);
    d.mutate();
    d.mutate();
    d.flushTimers();
    d.tickInterval();
    expect(d.sent).toHaveLength(1);
  });

  it("URL change to another ASIN sends a new observation", () => {
    const d = makeDeps(URL1, PDP("B0TESTASIN"));
    startObserver(d.deps);
    d.setUrl("https://www.amazon.com/gp/product/B0OTHERASI");
    d.setHtml(PDP("B0OTHERASI"));
    d.tickInterval();
    expect(d.sent).toHaveLength(2);
    expect(d.sent[1]).toMatchObject({ observation: { externalId: "B0OTHERASI" } });
  });

  it("price change on same page resends (mutation)", () => {
    const d = makeDeps(URL1, PDP("B0TESTASIN"));
    startObserver(d.deps);
    d.setHtml(PDP("B0TESTASIN", "$259.00"));
    d.mutate();
    d.flushTimers();
    expect(d.sent).toHaveLength(2);
    expect(d.sent[1]).toMatchObject({ observation: { priceCents: 25900 } });
  });

  it("non-product URL on a supported host → not_product_page once", () => {
    const d = makeDeps("https://www.amazon.com/", `<html><body>home</body></html>`);
    startObserver(d.deps);
    d.mutate();
    d.flushTimers();
    d.tickInterval();
    const failures = d.sent.filter((m) => m.type === "pt/extraction-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: "not_product_page", retailer: "amazon" });
  });

  it("sends extraction-failed once per URL", () => {
    const d = makeDeps(
      URL1,
      `<div id="dp" data-asin="B0NOPRICE1"><span id="productTitle">X</span></div>`,
    );
    startObserver(d.deps);
    d.mutate();
    d.flushTimers();
    d.tickInterval();
    const failures = d.sent.filter((m) => m.type === "pt/extraction-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: "no_price", retailer: "amazon" });
  });
});
