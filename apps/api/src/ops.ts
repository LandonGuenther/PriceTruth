import type { PrismaClient } from "@prisma/client";

/** Ops status payload shared by GET /internal/status and `pnpm ops status`. */
export async function getOpsStatus(prisma: PrismaClient) {
  const [latest, lastHour, last24h, statusGroups, jobRuns] = await Promise.all([
    prisma.priceObservation.aggregate({ _max: { receivedAt: true, id: true } }),
    prisma.priceObservation.count({
      where: { receivedAt: { gte: new Date(Date.now() - 3_600_000) } },
    }),
    prisma.priceObservation.count({
      where: { receivedAt: { gte: new Date(Date.now() - 86_400_000) } },
    }),
    prisma.priceObservation.groupBy({ by: ["status"], _count: true }),
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);

  const maxObsId = latest._max.id ?? 0n;

  const serializeRun = (
    r: {
      id: bigint;
      jobName: string;
      startedAt: Date;
      finishedAt: Date | null;
      status: string;
      summary: unknown;
      error: string | null;
      workerId: string;
    } | null,
  ) => (r ? { ...r, id: r.id.toString() } : null);

  const jobInfo = async (jobName: string, checkpointName: string) => {
    const [cp, lastRun, lastOk] = await Promise.all([
      prisma.jobCheckpoint.findUnique({ where: { jobName: checkpointName } }),
      prisma.jobRun.findFirst({ where: { jobName }, orderBy: { startedAt: "desc" } }),
      prisma.jobRun.findFirst({
        where: { jobName, status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
    ]);
    const cursor = cp ? BigInt(cp.cursor) : 0n;
    return {
      checkpoint: cursor.toString(),
      lastRun: serializeRun(lastRun),
      lastSuccessAt: lastOk?.finishedAt ?? null,
      lagObservations: Number(maxObsId - cursor),
      ...(jobName === "archive" ? { batches: await prisma.archiveBatch.count() } : {}),
    };
  };

  const [rollup, archive, retailers, listings, products, families, dataSources] = await Promise.all(
    [
      jobInfo("rollup", "rollup:observations"),
      jobInfo("archive", "archive:observations"),
      prisma.retailer.count(),
      prisma.listing.count(),
      prisma.product.count(),
      prisma.productFamily.count(),
      prisma.dataSource.count(),
    ],
  );

  return {
    latestObservationReceivedAt: latest._max.receivedAt,
    observationsLastHour: lastHour,
    observationsLast24h: last24h,
    statusDistribution: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
    rollup: {
      checkpoint: rollup.checkpoint,
      lastRun: rollup.lastRun,
      lagObservations: rollup.lagObservations,
    },
    archive: {
      checkpoint: archive.checkpoint,
      lastSuccessAt: archive.lastSuccessAt,
      lagObservations: archive.lagObservations,
      batches: archive.batches,
    },
    counts: { retailers, listings, products, families, dataSources },
    lastJobRuns: jobRuns.map(serializeRun),
  };
}
