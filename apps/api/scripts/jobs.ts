/**
 * Batch jobs CLI.
 *
 *   pnpm --filter @pricetruth/api jobs rollup [--batch-size 5000]
 *   pnpm --filter @pricetruth/api jobs archive --dir <path> [--max-batches N]
 */
import { PrismaClient } from "@prisma/client";
import { runDailyRollupJob } from "../src/jobs/dailyRollup.js";

const prisma = new PrismaClient();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "rollup") {
    const batchSize = Number(flag("batch-size") ?? 5000);
    const r = await runDailyRollupJob(prisma, { batchSize });
    console.log(
      `rollup: ${r.rolledDays} listing-day(s) recomputed ` +
        `(${r.scannedObservations} observations, ${r.scannedEvents} status events scanned)`,
    );
  } else {
    throw new Error(`unknown job: ${cmd}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
