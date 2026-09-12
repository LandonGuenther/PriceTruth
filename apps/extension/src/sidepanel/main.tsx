import { mountPanel } from "./mount.js";

const el = document.getElementById("root");
if (!el) throw new Error("PriceTruth side panel root element missing");
mountPanel(el);
