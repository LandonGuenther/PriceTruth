/**
 * DB-backed tests for job leases, the runJob ledger, rollup idempotency, and
 * archive export crash-recovery / integrity semantics.
 */
import { createHash } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { dataSourceId, describeIfDb, prisma, truncateAll } from "./helpers.js";
import { acquireLease, releaseLease, renewLease } from "../src/jobs/lease.js";
import { runJob } from "../src/jobs/runner.js";
import { runDailyRollupJob } from "../src/jobs/dailyRollup.js";
import { exportObservationBatches } from "../src/archive/exporter.js";
import { ArchiveIntegrityError, type ObservationArchive } from "../src/archive/types.js";

/** In-memory archive with injectable failures on putObject. */
class MemArchive implements ObservationArchive {
  objects = new Map<string, Uint8Array>();
  /** Fail on the Nth putObject call (1-based). */
  failOnPutCall = 0;
  private putCalls = 0;

  async putObject(key: string, b: Uint8Array): Promise<void> {
    this.putCalls++;
    if (this.putCalls === this.failOnPutCall) throw new Error("simulated put failure");
    this.objects.set(key, Buffer.from(b));
  }
  async getObject(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

const WORKER = "test-worker:1";

async function seedObservations(
  receivedAts: Date[],
  opts: { listingExternalId?: string } = {},
): Promise<string[]> {
  const listing = await prisma.listing.create({
    data: {
      retailer: {
        connectOrCreate: {
          where: { id: "amazon" },
          create: { id: "amazon", displayName: "Amazon" },
        },
      },
      externalId: opts.listingExternalId ?? "B0JOBASIN1",
      url: "https://www.amazon.com/dp/B0JOBASIN1",
      title: "Job Widget",
    },
  });
  const ds = await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST);
  const ids: string[] = [];
  for (const at of receivedAts) {
    const o = await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        dataSourceId: ds,
        priceCents: 10000,
        priceType: "STANDARD",
        currency: "USD",
        effectiveAt: at,
        receivedAt: at,
        schemaVersion: 1,
      },
    });
    ids.push(o.id.toString());
  }
  return ids;
}

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 12));

describeIfDb("job leases", () => {
  beforeEach(truncateAll);

  it("second worker cannot acquire a held lease; expired lease is reacquirable", async () => {
    expect(await acquireLease(prisma, "job:a", "w1", 60_000)).toBe(true);
    expect(await acquireLease(prisma, "job:a", "w2", 60_000)).toBe(false);
    // Expire w1's lease → w2 wins.
    await prisma.jobCheckpoint.update({
      where: { jobName: "job:a" },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect(await acquireLease(prisma, "job:a", "w2", 60_000)).toBe(true);
    // w1 can no longer renew or release.
    expect(await renewLease(prisma, "job:a", "w1", 60_000)).toBe(false);
    await releaseLease(prisma, "job:a", "w1");
    const row = await prisma.jobCheckpoint.findUniqueOrThrow({ where: { jobName: "job:a" } });
    expect(row.lockedBy).toBe("w2");
  });

  it("runJob: SUCCEEDED with summary; SKIPPED_LOCKED while held; FAILED on error", async () => {
    const ok = await runJob(prisma, "job:ok", async () => ({ rows: 3 }), { workerId: WORKER });
    expect(ok.skipped).toBe(false);
    expect((ok.summary as { rows: number }).rows).toBe(3);

    const held = await prisma.jobCheckpoint.findUniqueOrThrow({
      where: { jobName: "job:ok" },
    });
    expect(held.lockedBy).toBeNull(); // released

    // Hold the lease manually, then runJob skips.
    expect(await acquireLease(prisma, "job:held", "other", 60_000)).toBe(true);
    const skipped = await runJob(prisma, "job:held", async () => ({}), { workerId: WORKER });
    expect(skipped.skipped).toBe(true);

    await expect(
      runJob(
        prisma,
        "job:boom",
        async () => {
          throw new Error("kaboom internal detail");
        },
        { workerId: WORKER },
      ),
    ).rejects.toThrow("kaboom");

    const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "asc" } });
    const byJob = (n: string) => runs.filter((r) => r.jobName === n);
    expect(byJob("job:ok")[0]!.status).toBe("SUCCEEDED");
    expect(byJob("job:ok")[0]!.summary).toEqual({ rows: 3 });
    expect(byJob("job:held")[0]!.status).toBe("SKIPPED_LOCKED");
    const failed = byJob("job:boom")[0]!;
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("kaboom");
    expect(failed.error).not.toContain("\n"); // message only, no stack
    expect(failed.error).not.toMatch(/\bat \S+\(/); // no stack frames
    expect(failed.finishedAt).not.toBeNull();
  });
});

describeIfDb("rollup job", () => {
  beforeEach(truncateAll);

  it("is idempotent: a second run rolls zero days and rows are unchanged", async () => {
    await seedObservations([day(1), day(1), day(2)]);
    const r1 = await runDailyRollupJob(prisma, { batchSize: 500 });
    expect(r1.rolledDays).toBeGreaterThan(0);
    const rows1 = await prisma.listingDailyPrice.findMany();
    const r2 = await runDailyRollupJob(prisma, { batchSize: 500 });
    expect(r2.rolledDays).toBe(0);
    const rows2 = await prisma.listingDailyPrice.findMany();
    expect(rows2).toEqual(rows1);
  });

  it("stops between batches when the abort signal fires", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runDailyRollupJob(prisma, { signal: ac.signal });
    expect(r.rolledDays).toBe(0);
    expect(r.scannedObservations).toBe(0);
  });
});

describeIfDb("archive job", () => {
  beforeEach(truncateAll);

  it("crash mid-export → rerun completes, one ledger row per key, checkpoint at last id", async () => {
    const ids = await seedObservations([day(1), day(2), day(3)]);
    const failing = new MemArchive();
    failing.failOnPutCall = 3; // first partition writes parquet+manifest, second fails on parquet
    await expect(exportObservationBatches(prisma, failing, { batchSize: 100 })).rejects.toThrow(
      "simulated put failure",
    );

    const ledgerAfterCrash = await prisma.archiveBatch.count();
    expect(ledgerAfterCrash).toBeLessThan(3);

    const ok = new MemArchive();
    const r = await exportObservationBatches(prisma, ok, { batchSize: 100 });
    // Partition 1 already had a ledger row → skipped; partitions 2–3 written.
    expect(r.batches).toBe(2);
    expect(r.skipped).toBe(1);
    const ledger = await prisma.archiveBatch.findMany();
    expect(ledger).toHaveLength(3);
    expect(new Set(ledger.map((b) => b.key)).size).toBe(ledger.length);
    const cp = await prisma.jobCheckpoint.findUniqueOrThrow({
      where: { jobName: "archive:observations" },
    });
    expect(cp.cursor).toBe(ids[ids.length - 1]);
  });

  it("rerun with nothing new is a no-op", async () => {
    await seedObservations([day(1)]);
    const a = new MemArchive();
    await exportObservationBatches(prisma, a);
    const r2 = await exportObservationBatches(prisma, a);
    expect(r2.batches).toBe(0);
    expect(r2.rows).toBe(0);
    expect(await prisma.archiveBatch.count()).toBe(1);
  });

  it("object exists but no ledger row: same bytes → ledger backfilled; different → throws", async () => {
    await seedObservations([day(1)]);
    const a = new MemArchive();
    const r1 = await exportObservationBatches(prisma, a);
    const key = r1.writtenKeys[0]!;
    // Replay from cursor 0 with the object present but ledger row missing:
    // same bytes → backfill the ledger row, no throw.
    const resetCursor = () =>
      prisma.jobCheckpoint.update({
        where: { jobName: "archive:observations" },
        data: { cursor: "0" },
      });
    await prisma.archiveBatch.deleteMany();
    await resetCursor();
    const r2 = await exportObservationBatches(prisma, a);
    expect(await prisma.archiveBatch.count()).toBe(1);
    expect(r2.batches).toBe(1);

    // Different bytes present, ledger row missing → integrity error.
    await prisma.archiveBatch.deleteMany();
    await resetCursor();
    a.objects.set(key, Buffer.from("tampered"));
    await expect(exportObservationBatches(prisma, a)).rejects.toThrow(ArchiveIntegrityError);
    expect(await prisma.archiveBatch.count()).toBe(0);
    // Checkpoint unchanged by the failed run — still the reset cursor.
    expect(
      (
        await prisma.jobCheckpoint.findUniqueOrThrow({
          where: { jobName: "archive:observations" },
        })
      ).cursor,
    ).toBe("0");
  });

  it("parquet bytes are deterministic for a fixed row set", async () => {
    const ids = await seedObservations([day(5), day(5), day(6)]);
    const a = new MemArchive();
    await exportObservationBatches(prisma, a);
    const b = new MemArchive();
    // Reset ledger + checkpoint so the same rows are exported again.
    await prisma.archiveBatch.deleteMany();
    await prisma.jobCheckpoint.update({
      where: { jobName: "archive:observations" },
      data: { cursor: "0" },
    });
    await exportObservationBatches(prisma, b);
    for (const k of await a.list("")) {
      if (!k.endsWith(".parquet")) continue;
      const shaA = createHash("sha256")
        .update(await a.getObject(k))
        .digest("hex");
      const shaB = createHash("sha256")
        .update(await b.getObject(k))
        .digest("hex");
      expect(shaB).toBe(shaA);
    }
    expect(ids.length).toBe(3);
  });

  it("dry-run computes counts without writing anything", async () => {
    await seedObservations([day(1), day(2)]);
    const a = new MemArchive();
    const r = await exportObservationBatches(prisma, a, { dryRun: true });
    expect(r.batches).toBe(2);
    expect(r.rows).toBe(2);
    expect(a.objects.size).toBe(0);
    expect(await prisma.archiveBatch.count()).toBe(0);
    expect(
      await prisma.jobCheckpoint.findUnique({ where: { jobName: "archive:observations" } }),
    ).toBeNull();
  });
});
