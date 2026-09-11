import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pricetruth/shared": path.resolve(here, "../../packages/shared/src/index.ts"),
      "@pricetruth/scoring": path.resolve(here, "../../packages/scoring/src/index.ts"),
      "@pricetruth/catalog": path.resolve(here, "../../packages/catalog/src/index.ts"),
    },
  },
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    testTimeout: 30_000,
    // All API tests share one Postgres and truncate it; files must run
    // sequentially or a mid-test TRUNCATE in a sibling file corrupts state.
    fileParallelism: false,
  },
});
