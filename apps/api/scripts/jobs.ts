/**
 * Batch jobs CLI.
 *
 *   pnpm --filter @pricetruth/api jobs rollup [--batch-size 5000]
 *   pnpm --filter @pricetruth/api jobs archive [--dir <path>] [--max-batches N] [--dry-run]
 *
 * The archive backend is selected by ARCHIVE_BACKEND (local | s3); --dir
 * overrides ARCHIVE_LOCAL_DIR for the local backend. Both jobs run under a
 * JobCheckpoint lease + JobRun ledger (src/jobs/runner.ts).
 */
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { runDailyRollupJob } from "../src/jobs/dailyRollup.js";
import { runJob } from "../src/jobs/runner.js";
import { exportObservationBatches } from "../src/archive/exporter.js";
import { LocalFilesystemArchive } from "../src/archive/localFilesystem.js";
import { createS3Archive } from "../src/archive/s3.js";
import type { ObservationArchive } from "../src/archive/types.js";

const prisma = new PrismaClient();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const cmd = process.argv[2];
  const config = loadConfig();
  if (cmd === "rollup") {
    const batchSize = Number(flag("batch-size") ?? 5000);
    const out = await runJob(prisma, "rollup", ({ signal, heartbeat }) =>
      runDailyRollupJob(prisma, { batchSize, signal, heartbeat }),
    );
    if (out.skipped) {
      console.log("rollup: skipped — lease held by another worker");
      return;
    }
    const r = out.summary as {
      rolledDays: number;
      scannedObservations: number;
      scannedEvents: number;
    };
    console.log(
      `rollup: ${r.rolledDays} listing-day(s) recomputed ` +
        `(${r.scannedObservations} observations, ${r.scannedEvents} status events scanned)`,
    );
  } else if (cmd === "archive") {
    const dir = flag("dir");
    const maxBatches = flag("max-batches") === undefined ? undefined : Number(flag("max-batches"));
    const dryRun = hasFlag("dry-run");

    let archive: ObservationArchive;
    let destination: string;
    if (config.ARCHIVE_BACKEND === "s3") {
      archive = createS3Archive(config);
      destination = `s3://${config.S3_BUCKET}`;
    } else {
      destination = dir ?? config.ARCHIVE_LOCAL_DIR;
      archive = new LocalFilesystemArchive(destination);
    }

    const out = await runJob(prisma, "archive", ({ signal, heartbeat }) =>
      exportObservationBatches(prisma, archive, {
        maxBatches,
        destination,
        signal,
        heartbeat,
        dryRun,
      }),
    );
    if (out.skipped) {
      console.log("archive: skipped — lease held by another worker");
      return;
    }
    const r = out.summary as { batches: number; rows: number; skipped: number };
    console.log(
      `archive${dryRun ? " (dry-run)" : ""}: ${r.batches} batch(es) ` +
        `(${r.rows} rows exported, ${r.skipped} existing batch(es) skipped) → ${destination}`,
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
