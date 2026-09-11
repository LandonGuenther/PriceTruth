import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pricetruth/shared": path.resolve(here, "../../packages/shared/src/index.ts"),
      "@pricetruth/retailer-adapters": path.resolve(
        here,
        "../../packages/retailer-adapters/src/index.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
  },
});
