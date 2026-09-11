import { describe, expect, it } from "vitest";
import { mutationLooksRelevant } from "./mutationRelevance.js";

function el(tag: string, attrs: Record<string, string> = {}, parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else node.setAttribute(k, v);
  }
  parent?.appendChild(node);
  return node;
}

describe("mutationLooksRelevant", () => {
  it("matches price/title/identity containers by id or class", () => {
    const root = el("div");
    const price = el("span", { id: "corePrice_desktop" }, root);
    expect(mutationLooksRelevant(price)).toBe(true);
    const title = el("span", { id: "productTitle" }, root);
    expect(mutationLooksRelevant(title)).toBe(true);
    const asin = el("div", { className: "celwidget twister-plus-buying-options" }, root);
    expect(mutationLooksRelevant(asin)).toBe(true);
  });

  it("matches Best Buy sku / price-block markers", () => {
    const root = el("div");
    const sku = el("div", { className: "sku-title" }, root);
    expect(mutationLooksRelevant(sku)).toBe(true);
    const price = el("div", { "data-testid": "customer-price" }, root);
    expect(mutationLooksRelevant(price)).toBe(true);
  });

  it("ignores unrelated chrome like nav and footers", () => {
    const root = el("div");
    const nav = el("nav", { className: "nav-sprite" }, root);
    expect(mutationLooksRelevant(nav)).toBe(false);
    const footer = el("div", { id: "navFooter" }, root);
    expect(mutationLooksRelevant(footer)).toBe(false);
  });

  it("walks from text nodes to parent elements", () => {
    const root = el("div", { className: "a-price" });
    const text = document.createTextNode("$19.99");
    root.appendChild(text);
    expect(mutationLooksRelevant(text)).toBe(true);
  });
});
