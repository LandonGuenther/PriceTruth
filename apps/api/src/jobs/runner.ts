import { hostname } from "node:os";
import type { PrismaClient } from "@prisma/client";
import { acquireLease, releaseLease, renewLease } from "./lease.js";
import { metrics } from "../metrics.js";

export interface JobContext {
  /** Aborted on SIGTERM/SIGINT — check between batches and stop cleanly. */
  signal: AbortSignal;
  /** Renews the lease; throws if it was lost. Call between batches. */
  heartbeat: () => Promise<void>;
}

export interface RunJobResult {
  skipped: boolean;
  /** Whatever summary the job function returned (also stored on the JobRun). */
  summary?: unknown;
}

const defaultWorkerId = () => `${hostname()}:${process.pid}`;

/**
 * Lease-guarded job runner: at most one worker runs `jobName` at a time.
 * Every invocation appends a JobRun ledger row (RUNNING → SUCCEEDED/FAILED,
 * or SKIPPED_LOCKED when another worker holds the lease). The lease is
 * always released in `finally`; job cursors in JobCheckpoint persist per
 * batch, so a crashed run simply resumes from its checkpoint next time.
 */
export async function runJob(
  prisma: PrismaClient,
  jobName: string,
  fn: (ctx: JobContext) => Promise<unknown>,
  opts: { ttlMs?: number; workerId?: string } = {},
): Promise<RunJobResult> {
  const ttlMs = opts.ttlMs ?? 600_000;
  const workerId = opts.workerId ?? defaultWorkerId();

  if (!(await acquireLease(prisma, jobName, workerId, ttlMs))) {
    await prisma.jobRun.create({
      data: { jobName, status: "SKIPPED_LOCKED", finishedAt: new Date(), workerId },
    });
    metrics.inc("job_runs_total", { job: jobName, status: "skipped_locked" });
    return { skipped: true };
  }

  const run = await prisma.jobRun.create({
    data: { jobName, status: "RUNNING", workerId },
  });

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  const heartbeat = async () => {
    if (!(await renewLease(prisma, jobName, workerId, ttlMs))) {
      throw new Error(`job ${jobName} lease lost`);
    }
  };

  try {
    const summary = await fn({ signal: ac.signal, heartbeat });
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        summary:
          summary === undefined
            ? undefined
            : (JSON.parse(
                JSON.stringify(summary, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
              ) as never),
      },
    });
    metrics.inc("job_runs_total", { job: jobName, status: "succeeded" });
    return { skipped: false, summary };
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        // No stack in the DB — name + message only.
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      },
    });
    metrics.inc("job_runs_total", { job: jobName, status: "failed" });
    throw err;
  } finally {
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
    await releaseLease(prisma, jobName, workerId);
  }
}
