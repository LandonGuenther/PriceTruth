import { createHash } from "node:crypto";
import type { WriteStream } from "node:fs";
import type { PrismaClient } from "@prisma/client";
// @dsnp/parquetjs is CJS; default-import under our ESM/NodeNext setup.
import parquetjs from "@dsnp/parquetjs";
import type { ObservationArchive } from "./types.js";

const { ParquetSchema, ParquetWriter } = parquetjs;

export const ARCHIVE_SCHEMA_VERSION = 1;
const CHECKPOINT = "archive:observations";
const SOFTWARE_VERSION = "pricetruth-archive@1.0.0";

/**
 * Parquet schema v1: immutable PriceObservation fact columns + retailerId +
 * dataSourceKey. `status` is deliberately excluded — it is the only mutable
 * column, and a later status change would make a re-export of the same id
 * range produce a different sha256 (tripping the refuse-to-overwrite guard).
 * Archiving ObservationStatusEvent is PLANNED (docs/ARCHIVE_FORMAT.md).
 */
export const ARCHIVE_PARQUET_SCHEMA = new ParquetSchema({
  id: { type: "INT64" },
  listingId: { type: "UTF8" },
  variantId: { type: "UTF8", optional: true },
  dataSourceId: { type: "UTF8" },
  priceCents: { type: "INT32" },
  priceType: { type: "UTF8" },
  referencePriceCents: { type: "INT32", optional: true },
  referenceType: { type: "UTF8", optional: true },
  currency: { type: "UTF8" },
  inStock: { type: "BOOLEAN", optional: true },
  receivedAt: { type: "TIMESTAMP_MILLIS" },
  clientObservedAt: { type: "TIMESTAMP_MILLIS", optional: true },
  effectiveAt: { type: "TIMESTAMP_MILLIS" },
  clientSkewSeconds: { type: "INT32", optional: true },
  synthetic: { type: "BOOLEAN" },
  schemaVersion: { type: "INT32" },
  clientVersion: { type: "UTF8", optional: true },
  extractorVersion: { type: "UTF8", optional: true },
  retailerId: { type: "UTF8" },
  dataSourceKey: { type: "UTF8" },
});

type ExportRow = Record<string, unknown> & {
  id: bigint;
  receivedAt: Date;
  retailerId: string;
};

function partitionKey(row: ExportRow, firstId: bigint, lastId: bigint): string {
  const d = row.receivedAt.toISOString();
  return (
    `schema=v1/retailer=${row.retailerId}` +
    `/year=${d.slice(0, 4)}/month=${d.slice(5, 7)}/day=${d.slice(8, 10)}` +
    `/part-${firstId}-${lastId}.parquet`
  );
}

export interface BatchManifest {
  schemaVersion: number;
  rowCount: number;
  firstObservationId: string;
  lastObservationId: string;
  minReceivedAt: string;
  maxReceivedAt: string;
  createdAt: string;
  softwareVersion: string;
  sha256: string;
  destination: string;
}

async function writeParquet(rows: ExportRow[]): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const stream = {
    write(
      b: Buffer,
      cbOrEnc?: BufferEncoding | ((e: Error | null | undefined) => void),
      cb?: (e: Error | null | undefined) => void,
    ) {
      chunks.push(Buffer.from(b));
      const done = typeof cbOrEnc === "function" ? cbOrEnc : cb;
      if (done) done(null);
      return true;
    },
    end(cb?: (e: Error | null | undefined) => void) {
      if (typeof cb === "function") cb(null);
      // Minimal in-memory stand-in for a writable stream; only write()/end()
      // are ever called by the parquet writer.
      return stream as unknown as WriteStream;
    },
  };
  const writer = await ParquetWriter.openStream(ARCHIVE_PARQUET_SCHEMA, stream);
  for (const r of rows) {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) row[k] = v === undefined ? null : v;
    await writer.appendRow(row);
  }
  await writer.close();
  return Buffer.concat(chunks);
}

export interface ExportResult {
  batches: number;
  rows: number;
  skipped: number;
  writtenKeys: string[];
}

/**
 * Incremental parquet export: rows with id > JobCheckpoint
 * "archive:observations" are read in ascending-id batches, partitioned by
 * receivedAt UTC day + retailer, and written as `<key>.parquet` + sibling
 * `<key>.manifest.json`. Idempotent: an existing manifest with an equal sha256
 * is skipped; a mismatched sha256 throws — never overwrite. Postgres is never
 * deleted or mutated by this job except the ArchiveBatch ledger + checkpoint.
 */
export async function exportObservationBatches(
  prisma: PrismaClient,
  archive: ObservationArchive,
  opts: { batchSize?: number; maxBatches?: number; destination?: string } = {},
): Promise<ExportResult> {
  const batchSize = opts.batchSize ?? 50_000;
  const destination = opts.destination ?? "local";
  const result: ExportResult = { batches: 0, rows: 0, skipped: 0, writtenKeys: [] };

  const checkpoint = await prisma.jobCheckpoint.findUnique({ where: { jobName: CHECKPOINT } });
  let cursor = checkpoint ? BigInt(checkpoint.cursor) : 0n;

  for (;;) {
    if (opts.maxBatches !== undefined && result.batches >= opts.maxBatches) break;
    const rows = await prisma.priceObservation.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: batchSize,
      include: { listing: { select: { retailerId: true } }, dataSource: { select: { key: true } } },
    });
    if (rows.length === 0) break;

    const flat: ExportRow[] = rows.map((o) => ({
      id: o.id,
      listingId: o.listingId,
      variantId: o.variantId,
      dataSourceId: o.dataSourceId,
      priceCents: o.priceCents,
      priceType: o.priceType,
      referencePriceCents: o.referencePriceCents,
      referenceType: o.referenceType,
      currency: o.currency,
      inStock: o.inStock,
      receivedAt: o.receivedAt,
      clientObservedAt: o.clientObservedAt,
      effectiveAt: o.effectiveAt,
      clientSkewSeconds: o.clientSkewSeconds,
      synthetic: o.synthetic,
      schemaVersion: o.schemaVersion,
      clientVersion: o.clientVersion,
      extractorVersion: o.extractorVersion,
      retailerId: o.listing.retailerId,
      dataSourceKey: o.dataSource.key,
    }));

    // Group contiguous-by-partition: key must be deterministic for idempotency,
    // so partition = (retailer, receivedAt day) of each row, named by its own
    // first/last observation id within this fetch.
    const groups = new Map<string, ExportRow[]>();
    for (const r of flat) {
      const day = r.receivedAt.toISOString().slice(0, 10);
      const k = `${r.retailerId}|${day}`;
      const g = groups.get(k);
      if (g) g.push(r);
      else groups.set(k, [r]);
    }

    for (const group of groups.values()) {
      const firstId = group[0]!.id;
      const lastId = group[group.length - 1]!.id;
      const key = partitionKey(group[0]!, firstId, lastId);
      const bytes = await writeParquet(group);
      const sha256 = createHash("sha256").update(bytes).digest("hex");

      const existing = await prisma.archiveBatch.findUnique({ where: { key } });
      const manifestKey = `${key.slice(0, -".parquet".length)}.manifest.json`;
      if (existing) {
        if (existing.sha256 !== sha256) {
          throw new Error(
            `archive batch ${key} exists with different sha256 — refusing to overwrite`,
          );
        }
        result.skipped++;
        continue;
      }

      const manifest: BatchManifest = {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        rowCount: group.length,
        firstObservationId: firstId.toString(),
        lastObservationId: lastId.toString(),
        minReceivedAt: group[0]!.receivedAt.toISOString(),
        maxReceivedAt: group[group.length - 1]!.receivedAt.toISOString(),
        createdAt: new Date().toISOString(),
        softwareVersion: SOFTWARE_VERSION,
        sha256,
        destination,
      };
      await archive.putObject(key, bytes);
      await archive.putObject(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2)));
      await prisma.archiveBatch.create({
        data: {
          key,
          firstObservationId: firstId,
          lastObservationId: lastId,
          rowCount: group.length,
          sha256,
        },
      });
      result.batches++;
      result.writtenKeys.push(key);
    }

    result.rows += flat.length;
    cursor = flat[flat.length - 1]!.id;
    await prisma.jobCheckpoint.upsert({
      where: { jobName: CHECKPOINT },
      create: { jobName: CHECKPOINT, cursor: cursor.toString() },
      update: { cursor: cursor.toString() },
    });
    if (rows.length < batchSize) break;
  }
  return result;
}
