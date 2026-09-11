import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Applies migrations before any test file runs. Skipped when DATABASE_URL is unset. */
export function setup(): void {
  if (!process.env.DATABASE_URL) {
    console.warn("[api tests] DATABASE_URL is not set — integration tests will be skipped.");
    return;
  }
  execSync("pnpm exec prisma migrate deploy", {
    cwd: path.resolve(here, ".."),
    env: process.env,
    stdio: "inherit",
  });
}

export function teardown(): void {
  /* nothing to clean up */
}
