import { PRODUCT_NAME } from "@pricetruth/shared";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

let root: Root | undefined;

/** Mount the analysis panel into any host element (side panel or action popup). */
export function mountPanel(container: HTMLElement): Root {
  document.title = PRODUCT_NAME;
  root?.unmount();
  root = createRoot(container);
  root.render(<App />);
  return root;
}
