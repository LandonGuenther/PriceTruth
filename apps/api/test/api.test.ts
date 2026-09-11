import { afterAll, beforeEach, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { analyzeListing } from "@pricetruth/scoring";
import {
  amazonObservation,
  describeIfDb,
  makeApp,
  prisma,
  testConfig,
  truncateAll,
} from "./helpers.js";
import type { FetchLike } from "../src/services/bestbuyApi.js";

describeIfDb("api integration", () => {
  beforeEach(truncateAll);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET /health returns ok with db ok", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.product).toBe("string");
    await app.close();
  });

  it("POST valid amazon observation → 201, listing + product + identifiers created", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation(),
      headers: { "user-agent": "vitest", "x-pricetruth-client-version": "0.1.0" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.enrichment.bestbuyApi).toBe("skipped");

    const listing = await prisma.listing.findUnique({
      where: { retailerId_externalId: { retailerId: "amazon", externalId: "B0TESTASIN" } },
      include: { product: { include: { identifiers: true } } },
    });
    expect(listing).not.toBeNull();
    expect(listing!.title).toBe("Test Widget");
    const idTypes = listing!.product!.identifiers.map((i) => i.type).sort();
    expect(idTypes).toEqual(["ASIN", "GTIN"]);

    const obs = await prisma.priceObservation.findFirst({ where: { listingId: listing!.id } });
    expect(obs!.clientVersion).toBe("0.1.0");
    expect(obs!.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(obs!.synthetic).toBe(false);
    await app.close();
  });

  it("identical observation within 60 min → 200 duplicate, row count unchanged", async () => {
    const app = await makeApp();
    const o = amazonObservation();
    await app.inject({ method: "POST", url: "/v1/observations", payload: o });
    const res = await app.inject({ method: "POST", url: "/v1/observations", payload: o });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
    expect(await prisma.priceObservation.count()).toBe(1);
    await app.close();
  });

  it("different price → new row", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const r2 = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ priceCents: 28900 }),
    });
    expect(r2.statusCode).toBe(201);
    expect(await prisma.priceObservation.count()).toBe(2);
    await app.close();
  });

  it("same price but observedAt 61 min later → new row", async () => {
    const app = await makeApp();
    const t0 = Date.now() - 90 * 60_000; // original observation 90 min ago
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ observedAt: new Date(t0).toISOString() }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation(),
    });
    expect(res.statusCode).toBe(201);
    expect(await prisma.priceObservation.count()).toBe(2);
    await app.close();
  });

  it("invalid bodies → 400", async () => {
    const app = await makeApp();
    const cases: unknown[] = [
      amazonObservation({ priceCents: 1.5 }),
      amazonObservation({ currency: "usd" }),
      { ...amazonObservation(), retailer: "walmart" },
      amazonObservation({ observedAt: new Date(Date.now() + 60 * 60_000).toISOString() }),
      amazonObservation({ observedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }),
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: "POST", url: "/v1/observations", payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    await app.close();
  });

  it("analysis 404 for unknown listing", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/v1/listings/amazon/NOPE/analysis" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("listing_not_found");
    await app.close();
  });

  it("analysis with 1 observation → INSUFFICIENT, null scores", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const res = await app.inject({
      method: "GET",
      url: "/v1/listings/amazon/B0TESTASIN/analysis",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.confidence.level).toBe("INSUFFICIENT");
    expect(body.dealScore.score).toBeNull();
    expect(body.discountIntegrity.score).toBeNull();
    expect(body.currentPriceCents).toBe(29900);
    await app.close();
  });

  it("analysis matches analyzeListing run directly on the same 120-day series", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const listing = await prisma.listing.findFirstOrThrow();

    const now = Date.now();
    const rows = Array.from({ length: 120 }, (_, i) => ({
      listingId: listing.id,
      priceCents: 30000 + (i % 5) * 100,
      referencePriceCents: null,
      currency: "USD",
      source: "test-seed",
      observedAt: new Date(now - (119 - i) * 86_400_000),
      synthetic: false,
    }));
    await prisma.priceObservation.createMany({ data: rows });
    // make the newest stored observation current
    await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        priceCents: 29900,
        referencePriceCents: 49900,
        currency: "USD",
        source: "test-seed",
        observedAt: new Date(now),
        synthetic: false,
      },
    });
    await prisma.priceObservation.deleteMany({
      where: { listingId: listing.id, source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/listings/amazon/B0TESTASIN/analysis",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const stored = await prisma.priceObservation.findMany({
      where: { listingId: listing.id, synthetic: false },
      orderBy: { observedAt: "asc" },
    });
    const direct = analyzeListing({
      observations: stored.map((o) => ({
        priceCents: o.priceCents,
        referencePriceCents: o.referencePriceCents,
        observedAt: o.observedAt.toISOString(),
        source: o.source,
      })),
      asOf: new Date(),
    });
    expect(body.stats).toEqual(direct.stats);
    expect(body.confidence).toEqual(direct.confidence);
    expect(body.dealScore).toEqual(direct.dealScore);
    expect(body.discountIntegrity).toEqual(direct.discountIntegrity);
    expect(body.typical).toEqual(direct.typical);
    await app.close();
  });

  it("synthetic rows are excluded from analysis and history", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const listing = await prisma.listing.findFirstOrThrow();
    await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        priceCents: 100,
        currency: "USD",
        source: "test-synthetic",
        observedAt: new Date(Date.now() - 60_000),
        synthetic: true,
      },
    });
    const analysis = (
      await app.inject({
        method: "GET",
        url: "/v1/listings/amazon/B0TESTASIN/analysis",
      })
    ).json();
    expect(analysis.stats.observationCount).toBe(1);
    const history = (
      await app.inject({ method: "GET", url: "/v1/listings/amazon/B0TESTASIN/history" })
    ).json();
    expect(history.points).toHaveLength(1);
    await app.close();
  });

  it("history: days filter, daily series, validation", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const listing = await prisma.listing.findFirstOrThrow();
    const now = Date.now();
    // two obs same day (median), one old obs 200 days back
    await prisma.priceObservation.createMany({
      data: [
        {
          listingId: listing.id,
          priceCents: 31000,
          currency: "USD",
          source: "t",
          observedAt: new Date(now - 60_000),
          synthetic: false,
        },
        {
          listingId: listing.id,
          priceCents: 50000,
          currency: "USD",
          source: "t",
          observedAt: new Date(now - 200 * 86_400_000),
          synthetic: false,
        },
      ],
    });

    const h180 = (
      await app.inject({ method: "GET", url: "/v1/listings/amazon/B0TESTASIN/history?days=180" })
    ).json();
    expect(h180.days).toBe(180);
    expect(h180.points).toHaveLength(2);
    expect(h180.daily).toHaveLength(1); // both today → one day, median(29900,31000)=30450
    expect(h180.daily[0].medianPriceCents).toBe(30450);

    const h365 = (
      await app.inject({ method: "GET", url: "/v1/listings/amazon/B0TESTASIN/history?days=365" })
    ).json();
    expect(h365.points).toHaveLength(3);
    expect(h365.daily).toHaveLength(2);

    const bad = await app.inject({
      method: "GET",
      url: "/v1/listings/amazon/B0TESTASIN/history?days=9999",
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("CORS preflight from chrome-extension:// origin is allowed", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/observations",
      headers: {
        origin: "chrome-extension://abcdefghijklmnop",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmnop");
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/observations",
      headers: { origin: "https://evil.example" },
      payload: amazonObservation(),
    });
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("bestbuy enrichment: injected fetch records a bestbuy:products-api row", async () => {
    const fetchImpl: FetchLike = async (url) => {
      expect(url).toContain("api.bestbuy.com/v1/products(sku=6418599)");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sku: 6418599,
          name: "BB Widget",
          salePrice: 279.99,
          regularPrice: 399.99,
          onlineAvailability: true,
          upc: "0012345678999",
          manufacturer: "Acme",
          modelNumber: "AC-2",
        }),
      };
    };
    const app = await makeApp(testConfig({ BESTBUY_API_KEY: "test-key" }), fetchImpl);
    const res = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        ...amazonObservation(),
        retailer: "bestbuy",
        externalId: "6418599",
        url: "https://www.bestbuy.com/site/x/6418599.p?skuId=6418599",
        gtin: undefined,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().enrichment.bestbuyApi).toBe("recorded");
    const apiRows = await prisma.priceObservation.findMany({
      where: { source: OBSERVATION_SOURCES.BESTBUY_API },
    });
    expect(apiRows).toHaveLength(1);
    expect(apiRows[0]!.priceCents).toBe(27999);
    expect(apiRows[0]!.referencePriceCents).toBe(39999);
    // second request within 60 min → duplicate, no second API row
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        ...amazonObservation({ priceCents: 28800 }),
        retailer: "bestbuy",
        externalId: "6418599",
        url: "https://www.bestbuy.com/site/x/6418599.p?skuId=6418599",
        gtin: undefined,
      },
    });
    expect(res2.json().enrichment.bestbuyApi).toBe("duplicate");
    expect(await prisma.priceObservation.count({ where: { source: "bestbuy:products-api" } })).toBe(
      1,
    );
    await app.close();
  });

  it("bestbuy enrichment disabled without key, error path still 201", async () => {
    const app1 = await makeApp(testConfig({ BESTBUY_API_KEY: undefined }));
    const r1 = await app1.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        ...amazonObservation(),
        retailer: "bestbuy",
        externalId: "6418599",
        url: "https://www.bestbuy.com/site/x/6418599.p",
        gtin: undefined,
      },
    });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().enrichment.bestbuyApi).toBe("disabled");
    await app1.close();

    const throwingFetch: FetchLike = async () => {
      throw new Error("network down");
    };
    const app2 = await makeApp(testConfig({ BESTBUY_API_KEY: "k" }), throwingFetch);
    const r2 = await app2.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        ...amazonObservation(),
        retailer: "bestbuy",
        externalId: "1234567",
        url: "https://www.bestbuy.com/site/x/1234567.p",
        gtin: undefined,
      },
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().enrichment.bestbuyApi).toBe("error");
    await app2.close();
  });
});
