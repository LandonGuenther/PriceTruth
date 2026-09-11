import type { PrismaClient } from "@prisma/client";

/**
 * Job leases live on the JobCheckpoint row keyed by `jobName` (the row is
 * created with a neutral "0" cursor if absent — real cursors are written by
 * the job itself).
 */

/** Atomic single-statement acquire; true iff this worker now holds the lease. */
export async function acquireLease(
  prisma: PrismaClient,
  jobName: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  await prisma.jobCheckpoint.upsert({
    where: { jobName },
    create: { jobName, cursor: "0" },
    update: {},
  });
  const n = await prisma.$executeRaw`
    UPDATE "JobCheckpoint"
    SET "lockedBy" = ${workerId}, "lockedUntil" = ${new Date(Date.now() + ttlMs)}
    WHERE "jobName" = ${jobName}
      AND ("lockedUntil" IS NULL OR "lockedUntil" < now())`;
  return n === 1;
}

/** Extend the lease; false if it was lost (expired or stolen). */
export async function renewLease(
  prisma: PrismaClient,
  jobName: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE "JobCheckpoint"
    SET "lockedUntil" = ${new Date(Date.now() + ttlMs)}
    WHERE "jobName" = ${jobName} AND "lockedBy" = ${workerId}`;
  return n === 1;
}

/** Release only if we still own it. */
export async function releaseLease(
  prisma: PrismaClient,
  jobName: string,
  workerId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "JobCheckpoint"
    SET "lockedBy" = NULL, "lockedUntil" = NULL
    WHERE "jobName" = ${jobName} AND "lockedBy" = ${workerId}`;
}
