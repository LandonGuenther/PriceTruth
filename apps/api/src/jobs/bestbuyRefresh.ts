import { Prisma, type PrismaClient } from "@prisma/client";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import type { FetchLike } from "../services/bestbuyApi.js";
import { recordBestBuyApiObservation } from "../services/observationService.js";

export interface BestBuyRefreshOptions {
  apiKey: string;
  /** Skip listings whose latest official-API observation is newer than this. */
  minAgeHours?: number;
  maxListings?: number;
  /** Pause between API calls (concurrency is always 1). */
  delayMs?: number;
  signal?: AbortSignal;
  heartbeat?: () => Promise<void>;
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface BestBuyRefreshSummary {
  candidates: number;
  recorded: number;
  duplicate: number;
  error: number;
  skipped: number;
}

interface CandidateRow {
  id: string;
  externalId: string;
  lastApiAt: Date | null;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Refresh known Best Buy listings from the official Products API, oldest
 * (or never) refreshed first. Append-only: records new `bestbuy:products-api`
 * observations via the same path as ingest-time enrichment.
 */
export async function runBestBuyRefreshJob(
  prisma: PrismaClient,
  opts: BestBuyRefreshOptions,
): Promise<BestBuyRefreshSummary> {
  const minAgeHours = opts.minAgeHours ?? 6;
  const maxListings = opts.maxListings ?? 200;
  const delayMs = opts.delayMs ?? 1000;
  const now = opts.now ?? new Date();
  const summary: BestBuyRefreshSummary = {
    candidates: 0,
    recorded: 0,
    duplicate: 0,
    error: 0,
    skipped: 0,
  };

  const dataSource = await prisma.dataSource.findUnique({
    where: { key: OBSERVATION_SOURCES.BESTBUY_API },
  });
  if (!dataSource) throw new Error(`data source ${OBSERVATION_SOURCES.BESTBUY_API} missing`);

  const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT l.id, l."externalId", MAX(o."effectiveAt") AS "lastApiAt"
    FROM "Listing" l
    LEFT JOIN "PriceObservation" o
      ON o."listingId" = l.id AND o."dataSourceId" = ${dataSource.id}::uuid
    WHERE l."retailerId" = 'bestbuy'
    GROUP BY l.id
    ORDER BY "lastApiAt" ASC NULLS FIRST, l."createdAt" ASC
    LIMIT ${maxListings}
  `);
  summary.candidates = rows.length;

  const freshCutoff = now.getTime() - minAgeHours * 3_600_000;
  let processed = 0;
  for (const row of rows) {
    if (opts.signal?.aborted) break;
    if (row.lastApiAt !== null && row.lastApiAt.getTime() > freshCutoff) {
      summary.skipped++;
      continue;
    }
    if (processed > 0) await sleep(delayMs, opts.signal);
    if (opts.signal?.aborted) break;

    const outcome = await recordBestBuyApiObservation(prisma, {
      dataSource,
      listingId: row.id,
      sku: row.externalId,
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl,
      now: opts.now,
    });
    summary[outcome]++;
    processed++;
    if (processed % 10 === 0 && opts.heartbeat) await opts.heartbeat();
  }
  return summary;
}
