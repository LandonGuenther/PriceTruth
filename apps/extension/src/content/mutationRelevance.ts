/** Prefer mutations that touch likely price/title/identity containers. */
const RELEVANT_MUTATION =
  /price|title|corePrice|availability|ASIN|productTitle|price-block|twister|apex_|buybox|customer-price|comp_value|sku/i;

export function mutationLooksRelevant(target: EventTarget | null): boolean {
  let node: Node | null = target as Node | null;
  if (node && node.nodeType === 3) node = node.parentElement;
  for (let el = node as Element | null; el; el = el.parentElement) {
    const id = el.id ?? "";
    const cls = typeof el.className === "string" ? el.className : String(el.className ?? "");
    const testid = el.getAttribute?.("data-testid") ?? "";
    if (RELEVANT_MUTATION.test(`${id} ${cls} ${testid}`)) return true;
    if (el.tagName === "BODY" || el.tagName === "HTML") break;
  }
  // childList additions under body often rebuild whole subtrees - allow those via addedNodes checks.
  return false;
}
