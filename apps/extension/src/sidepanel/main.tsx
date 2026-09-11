import { PRODUCT_NAME } from "@pricetruth/shared";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

document.title = PRODUCT_NAME;
createRoot(document.getElementById("root")!).render(<App />);
