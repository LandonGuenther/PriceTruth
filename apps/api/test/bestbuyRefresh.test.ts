/** DB-backed tests for the Best Buy official-API known-listing refresh job. */
import { beforeEach, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { dataSourceId, describeIfDb, prisma, truncateAll } from "./helpers.js";
import { runBestBuyRefreshJob } from "../src/jobs/bestbuyRefresh.js";
import type { FetchLike } from "../src/services/bestbuyApi.js";

const okFetch =
  (calls: string[] = []): FetchLike =>
  async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ sku: 6418599, salePrice: 299.99, regularPrice: 399.99 }),
    };
  };

async function seedListings() {
  await prisma.retailer.createMany({
    data: [
      { id: "bestbuy", displayName: "Best Buy" },
      { id: "amazon", displayName: "Amazon" },
    ],
    skipDuplicates: true,
  });
  const bb1 = await prisma.listing.create({
    data: {
      retailerId: "bestbuy",
      externalId: "6418599",
      url: "https://www.bestbuy.com/site/6418599.p",
      title: "BB One",
    },
  });
  const bb2 = await prisma.listing.create({
    data: {
      retailerId: "bestbuy",
      externalId: "6418600",
      url: "https://www.bestbuy.com/site/6418600.p",
      title: "BB Two",
    },
  });
  const amz = await prisma.listing.create({
    data: {
      retailerId: "amazon",
      externalId: "B0REFRESH1",
      url: "https://www.amazon.com/dp/B0REFRESH1",
      title: "Amazon Widget",
    },
  });
  return { bb1, bb2, amz };
}

describeIfDb("bestbuy-refresh job", () => {
  beforeEach(truncateAll);

  it("records official-API observations for bestbuy listings only", async () => {
    const { bb1, bb2, amz } = await seedListings();
    const calls: string[] = [];
    const summary = await runBestBuyRefreshJob(prisma, {
      apiKey: "k",
      delayMs: 0,
      fetchImpl: okFetch(calls),
    });
    expect(summary).toEqual({ candidates: 2, recorded: 2, duplicate: 0, error: 0, skipped: 0 });
    expect(calls).toHaveLength(2);

    const apiDs = await dataSourceId(OBSERVATION_SOURCES.BESTBUY_API);
    const rows = await prisma.priceObservation.findMany({ orderBy: { id: "asc" } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.listingId))).toEqual(new Set([bb1.id, bb2.id]));
    for (const r of rows) {
      expect(r.dataSourceId).toBe(apiDs);
      expect(r.synthetic).toBe(false);
      expect(r.priceType).toBe("STANDARD");
      expect(r.priceCents).toBe(29999);
      expect(r.referencePriceCents).toBe(39999);
      expect(r.referenceType).toBe("REGULAR_PRICE");
    }
    expect(await prisma.priceObservation.count({ where: { listingId: amz.id } })).toBe(0);
  });

  it("is idempotent within the freshness window: rerun skips, no new rows", async () => {
    await seedListings();
    await runBestBuyRefreshJob(prisma, { apiKey: "k", delayMs: 0, fetchImpl: okFetch() });
    const calls: string[] = [];
    const again = await runBestBuyRefreshJob(prisma, {
      apiKey: "k",
      delayMs: 0,
      fetchImpl: okFetch(calls),
    });
    expect(again).toEqual({ candidates: 2, recorded: 0, duplicate: 0, error: 0, skipped: 2 });
    expect(calls).toHaveLength(0);
    expect(await prisma.priceObservation.count()).toBe(2);

    // With the age gate disabled, the 60-minute dedup guard still holds.
    const dup = await runBestBuyRefreshJob(prisma, {
      apiKey: "k",
      delayMs: 0,
      minAgeHours: 0,
      fetchImpl: okFetch(),
    });
    expect(dup).toEqual({ candidates: 2, recorded: 0, duplicate: 2, error: 0, skipped: 0 });
    expect(await prisma.priceObservation.count()).toBe(2);
  });

  it("counts API failures as errors and writes nothing", async () => {
    await seedListings();
    const failing: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const summary = await runBestBuyRefreshJob(prisma, {
      apiKey: "k",
      delayMs: 0,
      fetchImpl: failing,
    });
    expect(summary).toEqual({ candidates: 2, recorded: 0, duplicate: 0, error: 2, skipped: 0 });
    expect(await prisma.priceObservation.count()).toBe(0);
  });

  it("stops after the current listing when the signal aborts", async () => {
    await seedListings();
    const ac = new AbortController();
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      ac.abort();
      return {
        ok: true,
        status: 200,
        json: async () => ({ salePrice: 10, regularPrice: 20 }),
      };
    };
    const summary = await runBestBuyRefreshJob(prisma, {
      apiKey: "k",
      delayMs: 0,
      signal: ac.signal,
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(summary).toEqual({ candidates: 2, recorded: 1, duplicate: 0, error: 0, skipped: 0 });
    expect(await prisma.priceObservation.count()).toBe(1);
  });
});
