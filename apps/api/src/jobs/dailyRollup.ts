import type { Prisma, PrismaClient } from "@prisma/client";
import { ELIGIBLE_PRICE_TYPES, ELIGIBLE_STATUSES, median } from "@pricetruth/scoring";

export const ROLLUP_AGGREGATION_VERSION = 1;
const OBS_CURSOR = "rollup:observations";
const EVENT_CURSOR = "rollup:status-events";

export interface ListingDay {
  listingId: string;
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

type RollupTx = Pick<
  Prisma.TransactionClient,
  "priceObservation" | "listingDailyPrice" | "jobCheckpoint" | "observationStatusEvent"
>;

/**
 * Recompute one (listingId, day) cell from eligible raw rows and upsert.
 * If a day ends up with zero eligible rows (e.g. everything quarantined), any
 * stale rollup row is deleted so the table always reflects current status.
 */
export async function rollupDay(prisma: RollupTx, pair: ListingDay): Promise<void> {
  const dayStart = new Date(`${pair.day}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const rows = await prisma.priceObservation.findMany({
    where: {
      listingId: pair.listingId,
      synthetic: false,
      status: { in: [...ELIGIBLE_STATUSES] },
      priceType: { in: [...ELIGIBLE_PRICE_TYPES] },
      effectiveAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    select: {
      priceCents: true,
      referencePriceCents: true,
      currency: true,
      dataSourceId: true,
    },
  });

  const key = { listingId: pair.listingId, day: dayStart };
  if (rows.length === 0) {
    await prisma.listingDailyPrice.deleteMany({ where: key });
    return;
  }

  const prices = rows.map((r) => r.priceCents);
  const refs = rows.map((r) => r.referencePriceCents).filter((r): r is number => r !== null);
  const data = {
    currency: rows[rows.length - 1]!.currency,
    eligibleObservationCount: rows.length,
    lowCents: Math.min(...prices),
    highCents: Math.max(...prices),
    medianCents: Math.round(median(prices)!),
    firstCents: rows[0]!.priceCents,
    lastCents: rows[rows.length - 1]!.priceCents,
    referenceMedianCents: refs.length ? Math.round(median(refs)!) : null,
    sourceCount: new Set(rows.map((r) => r.dataSourceId)).size,
    aggregationVersion: ROLLUP_AGGREGATION_VERSION,
  };
  await prisma.listingDailyPrice.upsert({
    where: { listingId_day: key },
    create: { ...key, ...data },
    update: data,
  });
}

export async function rollupDays(prisma: RollupTx, pairs: ListingDay[]): Promise<number> {
  const seen = new Map<string, ListingDay>();
  for (const p of pairs) seen.set(`${p.listingId}:${p.day}`, p);
  if (seen.size === 0) return 0;

  // One ranged read per batch, grouped in JS — per-pair SELECTs make large
  // backfills painfully slow. A day with zero eligible rows is deleted.
  const listingIds = [...new Set([...seen.values()].map((p) => p.listingId))];
  const days = [...seen.values()].map((p) => p.day).sort();
  const min = new Date(`${days[0]}T00:00:00.000Z`);
  const max = new Date(new Date(`${days[days.length - 1]}T00:00:00.000Z`).getTime() + 86_400_000);
  const rows = await prisma.priceObservation.findMany({
    where: {
      listingId: { in: listingIds },
      synthetic: false,
      status: { in: [...ELIGIBLE_STATUSES] },
      priceType: { in: [...ELIGIBLE_PRICE_TYPES] },
      effectiveAt: { gte: min, lt: max },
    },
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    select: {
      listingId: true,
      effectiveAt: true,
      priceCents: true,
      referencePriceCents: true,
      currency: true,
      dataSourceId: true,
    },
  });
  const byPair = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.listingId}:${utcDay(r.effectiveAt)}`;
    const g = byPair.get(k);
    if (g) g.push(r);
    else byPair.set(k, [r]);
  }

  for (const p of seen.values()) {
    const group = byPair.get(`${p.listingId}:${p.day}`) ?? [];
    const key = { listingId: p.listingId, day: new Date(`${p.day}T00:00:00.000Z`) };
    if (group.length === 0) {
      await prisma.listingDailyPrice.deleteMany({ where: key });
      continue;
    }
    const prices = group.map((r) => r.priceCents);
    const refs = group.map((r) => r.referencePriceCents).filter((r): r is number => r !== null);
    const data = {
      currency: group[group.length - 1]!.currency,
      eligibleObservationCount: group.length,
      lowCents: Math.min(...prices),
      highCents: Math.max(...prices),
      medianCents: Math.round(median(prices)!),
      firstCents: group[0]!.priceCents,
      lastCents: group[group.length - 1]!.priceCents,
      referenceMedianCents: refs.length ? Math.round(median(refs)!) : null,
      sourceCount: new Set(group.map((r) => r.dataSourceId)).size,
      aggregationVersion: ROLLUP_AGGREGATION_VERSION,
    };
    await prisma.listingDailyPrice.upsert({
      where: { listingId_day: key },
      create: { ...key, ...data },
      update: data,
    });
  }
  return seen.size;
}

async function getCursor(tx: RollupTx, jobName: string): Promise<bigint> {
  const row = await tx.jobCheckpoint.findUnique({ where: { jobName } });
  return row ? BigInt(row.cursor) : 0n;
}

/**
 * Incremental, restartable rollup. Two cursors: new observation ids and new
 * status-event ids (a status flip re-rolls the affected day). Each batch —
 * pair collection, rollups, cursor advance — commits in one transaction.
 */
export async function runDailyRollupJob(
  prisma: PrismaClient,
  opts: { batchSize?: number } = {},
): Promise<{ rolledDays: number; scannedObservations: number; scannedEvents: number }> {
  const batchSize = opts.batchSize ?? 5000;
  const totals = { rolledDays: 0, scannedObservations: 0, scannedEvents: 0 };

  for (;;) {
    const progress = await prisma.$transaction(
      async (tx) => {
        const obsCursor = await getCursor(tx, OBS_CURSOR);
        const evCursor = await getCursor(tx, EVENT_CURSOR);

        const newObs = await tx.priceObservation.findMany({
          where: { id: { gt: obsCursor } },
          orderBy: { id: "asc" },
          take: batchSize,
          select: { id: true, listingId: true, effectiveAt: true },
        });
        const newEvents = await tx.observationStatusEvent.findMany({
          where: { id: { gt: evCursor } },
          orderBy: { id: "asc" },
          take: batchSize,
          select: { id: true, observation: { select: { listingId: true, effectiveAt: true } } },
        });

        const pairs: ListingDay[] = [
          ...newObs.map((o) => ({ listingId: o.listingId, day: utcDay(o.effectiveAt) })),
          ...newEvents.map((e) => ({
            listingId: e.observation.listingId,
            day: utcDay(e.observation.effectiveAt),
          })),
        ];
        const rolled = await rollupDays(tx, pairs);

        const nextObsCursor = newObs.length ? newObs[newObs.length - 1]!.id : obsCursor;
        const nextEvCursor = newEvents.length ? newEvents[newEvents.length - 1]!.id : evCursor;
        for (const [jobName, cursor] of [
          [OBS_CURSOR, nextObsCursor],
          [EVENT_CURSOR, nextEvCursor],
        ] as const) {
          await tx.jobCheckpoint.upsert({
            where: { jobName },
            create: { jobName, cursor: cursor.toString() },
            update: { cursor: cursor.toString() },
          });
        }
        return { obs: newObs.length, events: newEvents.length, pairs: rolled };
      },
      // a batch can span hundreds of listing-day pairs — default 5s is too tight
      { timeout: 120_000, maxWait: 10_000 },
    );

    totals.rolledDays += progress.pairs;
    totals.scannedObservations += progress.obs;
    totals.scannedEvents += progress.events;
    if (progress.obs < batchSize && progress.events < batchSize) break;
  }
  return totals;
}
