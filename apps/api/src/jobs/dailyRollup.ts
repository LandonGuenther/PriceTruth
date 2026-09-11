import { Prisma, type PrismaClient } from "@prisma/client";
import { ELIGIBLE_PRICE_TYPES, ELIGIBLE_STATUSES } from "@pricetruth/scoring";

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
  | "priceObservation"
  | "listingDailyPrice"
  | "jobCheckpoint"
  | "observationStatusEvent"
  | "$executeRaw"
>;

/**
 * Recompute a set of (listingId, day) cells from eligible raw rows in ONE
 * set-based statement: aggregate per pair, upsert rows that have eligible
 * data, delete stale rows for pairs that no longer do.
 */
export async function rollupDays(prisma: RollupTx, pairs: ListingDay[]): Promise<number> {
  const seen = new Map<string, ListingDay>();
  for (const p of pairs) seen.set(`${p.listingId}:${p.day}`, p);
  if (seen.size === 0) return 0;
  const list = [...seen.values()];
  const ids = list.map((p) => p.listingId);
  const days = list.map((p) => p.day);
  const statuses = Prisma.join(ELIGIBLE_STATUSES.map((s) => Prisma.sql`${s}::"ObservationStatus"`));
  const priceTypes = Prisma.join(ELIGIBLE_PRICE_TYPES.map((s) => Prisma.sql`${s}::"PriceType"`));

  await prisma.$executeRaw(Prisma.sql`
    WITH pairs AS (
      SELECT unnest(ARRAY[${Prisma.join(ids)}]::uuid[]) AS listing_id,
             unnest(ARRAY[${Prisma.join(days)}]::date[]) AS day
    ), agg AS (
      SELECT p.listing_id, p.day,
        count(*)::int                                   AS n,
        min(o."priceCents")                             AS low,
        max(o."priceCents")                             AS high,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o."priceCents"))::int AS med,
        (array_agg(o."priceCents" ORDER BY o."effectiveAt", o.id))[1]           AS first,
        (array_agg(o."priceCents" ORDER BY o."effectiveAt" DESC, o.id DESC))[1] AS last,
        (array_agg(o.currency     ORDER BY o."effectiveAt" DESC, o.id DESC))[1] AS currency,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o."referencePriceCents")
              FILTER (WHERE o."referencePriceCents" IS NOT NULL))::int           AS refmed,
        count(DISTINCT o."dataSourceId")::int           AS sources
      FROM pairs p
      JOIN "PriceObservation" o
        ON o."listingId" = p.listing_id
       AND o."effectiveAt" >= p.day::timestamp
       AND o."effectiveAt" <  (p.day + 1)::timestamp
      WHERE o.synthetic = false
        AND o.status IN (${statuses})
        AND o."priceType" IN (${priceTypes})
      GROUP BY 1, 2
    ), upserted AS (
      INSERT INTO "ListingDailyPrice"
        ("listingId", day, currency, "eligibleObservationCount", "lowCents", "highCents",
         "medianCents", "firstCents", "lastCents", "referenceMedianCents", "sourceCount",
         "aggregationVersion", "computedAt")
      SELECT listing_id, day, currency, n, low, high, med, first, last, refmed, sources,
             ${ROLLUP_AGGREGATION_VERSION}::int, now()
      FROM agg
      ON CONFLICT ("listingId", day) DO UPDATE SET
        currency = EXCLUDED.currency, "eligibleObservationCount" = EXCLUDED."eligibleObservationCount",
        "lowCents" = EXCLUDED."lowCents", "highCents" = EXCLUDED."highCents",
        "medianCents" = EXCLUDED."medianCents", "firstCents" = EXCLUDED."firstCents",
        "lastCents" = EXCLUDED."lastCents", "referenceMedianCents" = EXCLUDED."referenceMedianCents",
        "sourceCount" = EXCLUDED."sourceCount", "aggregationVersion" = EXCLUDED."aggregationVersion",
        "computedAt" = EXCLUDED."computedAt"
      RETURNING 1
    )
    DELETE FROM "ListingDailyPrice" d
    USING pairs p
    WHERE d."listingId" = p.listing_id AND d.day = p.day
      AND NOT EXISTS (SELECT 1 FROM agg a WHERE a.listing_id = p.listing_id AND a.day = p.day)
  `);
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
  opts: { batchSize?: number; signal?: AbortSignal; heartbeat?: () => Promise<void> } = {},
): Promise<{ rolledDays: number; scannedObservations: number; scannedEvents: number }> {
  const batchSize = opts.batchSize ?? 5000;
  const totals = { rolledDays: 0, scannedObservations: 0, scannedEvents: 0 };

  for (;;) {
    if (opts.signal?.aborted) break;
    await opts.heartbeat?.();
    // Neon round-trip latency from Fly can exceed Prisma's 5s default under load.
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
      { timeout: 60_000, maxWait: 10_000 },
    );

    totals.rolledDays += progress.pairs;
    totals.scannedObservations += progress.obs;
    totals.scannedEvents += progress.events;
    if (progress.obs < batchSize && progress.events < batchSize) break;
  }
  return totals;
}
