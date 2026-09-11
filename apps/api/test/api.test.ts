import { afterAll, beforeEach, expect, it } from "vitest";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { analyzeListing } from "@pricetruth/scoring";
import {
  amazonObservation,
  dataSourceId,
  describeIfDb,
  makeApp,
  prisma,
  testConfig,
  truncateAll,
} from "./helpers.js";
import { setObservationStatus } from "../src/services/observationService.js";
import { linkListing, unlinkListing } from "../src/services/catalogService.js";
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
    expect(idTypes).toEqual(["ASIN", "GTIN", "MANUFACTURER_MODEL"]);
    // ProductIdentifier stores normalized values (GTIN → 14 digits)
    const gtinRow = listing!.product!.identifiers.find((i) => i.type === "GTIN");
    expect(gtinRow!.value).toBe("00012345678905");

    const obs = await prisma.priceObservation.findFirst({
      where: { listingId: listing!.id },
      include: { dataSource: true },
    });
    expect(obs!.clientVersion).toBe("0.1.0");
    expect(obs!.extractorVersion).toBe("1.0.0");
    expect(obs!.schemaVersion).toBe(1);
    expect(obs!.priceType).toBe("STANDARD");
    expect(obs!.referenceType).toBe("UNKNOWN");
    expect(obs!.status).toBe("ACCEPTED");
    expect(obs!.synthetic).toBe(false);
    expect(obs!.dataSource.key).toBe(OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT);
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

  it("same price but effectiveAt >60 min earlier → new row (not a duplicate)", async () => {
    const app = await makeApp();
    const listing = await prisma.listing.create({
      data: {
        retailer: {
          connectOrCreate: {
            where: { id: "amazon" },
            create: { id: "amazon", displayName: "Amazon" },
          },
        },
        externalId: "B0TESTASIN",
        url: "https://www.amazon.com/dp/B0TESTASIN",
        title: "Test Widget",
      },
    });
    await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        dataSourceId: await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST),
        priceCents: 29900,
        priceType: "STANDARD",
        currency: "USD",
        effectiveAt: new Date(Date.now() - 61 * 60_000),
        schemaVersion: 1,
      },
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

  it("clients may not claim non-CLIENT_REPORTED sources", async () => {
    const app = await makeApp();
    for (const source of [
      OBSERVATION_SOURCES.BESTBUY_API,
      OBSERVATION_SOURCES.MANUAL,
      OBSERVATION_SOURCES.SYNTHETIC_TEST,
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/observations",
        payload: amazonObservation({ source }),
      });
      expect(res.statusCode, source).toBe(400);
      expect(res.json().error).toBe("invalid_observation");
    }
    expect(await prisma.priceObservation.count()).toBe(0);
    await app.close();
  });

  it("client-reported skew: effectiveAt is server time, clientObservedAt stored", async () => {
    const app = await makeApp();
    const clientTime = new Date(Date.now() - 5 * 60_000); // 5 min ago
    const res = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ observedAt: clientTime.toISOString() }),
    });
    expect(res.statusCode).toBe(201);
    const obs = await prisma.priceObservation.findFirstOrThrow();
    expect(Math.abs(obs.effectiveAt.getTime() - Date.now())).toBeLessThan(5000);
    // effectiveAt is exactly the same timestamp stored as receivedAt
    expect(obs.effectiveAt.getTime()).toBe(obs.receivedAt.getTime());
    expect(obs.clientObservedAt?.toISOString()).toBe(clientTime.toISOString());
    expect(obs.clientSkewSeconds).toBe(
      Math.round((clientTime.getTime() - obs.receivedAt.getTime()) / 1000),
    );
    await app.close();
  });

  it("invalid bodies → 400", async () => {
    const app = await makeApp();
    const cases: unknown[] = [
      amazonObservation({ priceCents: 1.5 }),
      amazonObservation({ priceCents: 0 }),
      amazonObservation({ currency: "usd" }),
      { ...amazonObservation(), retailer: "walmart" },
      amazonObservation({ observedAt: new Date(Date.now() + 60 * 60_000).toISOString() }),
      amazonObservation({ observedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }),
      amazonObservation({ source: "mystery:source" }),
      amazonObservation({ referenceType: undefined }),
      { ...amazonObservation(), referencePriceCents: undefined, referenceType: "UNKNOWN" },
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: "POST", url: "/v1/observations", payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }

    // schemaVersion has a dedicated error code when it is a known-but-wrong number
    const v2 = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: { ...amazonObservation(), schemaVersion: 2 },
    });
    expect(v2.statusCode).toBe(400);
    expect(v2.json().error).toBe("unsupported_schema_version");

    const missing = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: (() => {
        const body: Record<string, unknown> = { ...amazonObservation() };
        delete body.schemaVersion;
        return body;
      })(),
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("invalid_observation");
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
    const ds = await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST);
    const rows = Array.from({ length: 120 }, (_, i) => ({
      listingId: listing.id,
      dataSourceId: ds,
      priceCents: 30000 + (i % 5) * 100,
      priceType: "STANDARD" as const,
      referencePriceCents: null,
      currency: "USD",
      effectiveAt: new Date(now - (119 - i) * 86_400_000),
      schemaVersion: 1,
      synthetic: false,
    }));
    await prisma.priceObservation.createMany({ data: rows });
    // make the newest stored observation current
    await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        dataSourceId: ds,
        priceCents: 29900,
        priceType: "STANDARD",
        referencePriceCents: 49900,
        referenceType: "UNKNOWN",
        currency: "USD",
        effectiveAt: new Date(now),
        schemaVersion: 1,
        synthetic: false,
      },
    });
    const extObs = await prisma.priceObservation.findFirstOrThrow({
      where: {
        listingId: listing.id,
        dataSource: { key: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT },
      },
    });
    await setObservationStatus(prisma, extObs.id, "EXCLUDED", "test setup");

    const res = await app.inject({
      method: "GET",
      url: "/v1/listings/amazon/B0TESTASIN/analysis",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const stored = await prisma.priceObservation.findMany({
      where: { listingId: listing.id, synthetic: false, status: "ACCEPTED" },
      orderBy: { effectiveAt: "asc" },
      include: { dataSource: true },
    });
    const direct = analyzeListing({
      observations: stored.map((o) => ({
        priceCents: o.priceCents,
        referencePriceCents: o.referencePriceCents,
        effectiveAt: o.effectiveAt.toISOString(),
        sourceKey: o.dataSource.key,
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
        dataSourceId: await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST),
        priceCents: 100,
        priceType: "STANDARD",
        currency: "USD",
        effectiveAt: new Date(Date.now() - 60_000),
        schemaVersion: 1,
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
    const ds = await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST);
    await prisma.priceObservation.createMany({
      data: [
        {
          listingId: listing.id,
          dataSourceId: ds,
          priceCents: 31000,
          priceType: "STANDARD",
          currency: "USD",
          effectiveAt: new Date(now - 60_000),
          schemaVersion: 1,
          synthetic: false,
        },
        {
          listingId: listing.id,
          dataSourceId: ds,
          priceCents: 50000,
          priceType: "STANDARD",
          currency: "USD",
          effectiveAt: new Date(now - 200 * 86_400_000),
          schemaVersion: 1,
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
      where: { dataSource: { key: OBSERVATION_SOURCES.BESTBUY_API } },
    });
    expect(apiRows).toHaveLength(1);
    expect(apiRows[0]!.priceCents).toBe(27999);
    expect(apiRows[0]!.referencePriceCents).toBe(39999);
    expect(apiRows[0]!.priceType).toBe("STANDARD");
    expect(apiRows[0]!.referenceType).toBe("REGULAR_PRICE");
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
    expect(
      await prisma.priceObservation.count({
        where: { dataSource: { key: "bestbuy:products-api" } },
      }),
    ).toBe(1);
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

  it("variant payload creates a shared ListingVariant row", async () => {
    const app = await makeApp();
    const variant = { Size: "Large", Color: "Blue" };
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ variant }),
    });
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      // different price so dedup doesn't collapse the second row
      payload: amazonObservation({ priceCents: 29800, variant }),
    });
    const variants = await prisma.listingVariant.findMany();
    expect(variants).toHaveLength(1);
    expect(variants[0]!.attributes).toEqual(variant);
    const obs = await prisma.priceObservation.findMany({ orderBy: { id: "asc" } });
    expect(obs).toHaveLength(2);
    expect(obs[0]!.variantId).toBe(variants[0]!.id);
    expect(obs[1]!.variantId).toBe(variants[0]!.id);
    await app.close();
  });

  it("setObservationStatus appends an event and analysis excludes QUARANTINED rows", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ priceCents: 29800 }),
    });
    const newest = await prisma.priceObservation.findFirstOrThrow({
      orderBy: { id: "desc" },
    });
    await setObservationStatus(prisma, newest.id, "QUARANTINED", "suspicious row");

    const events = await prisma.observationStatusEvent.findMany({
      where: { observationId: newest.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.fromStatus).toBe("ACCEPTED");
    expect(events[0]!.toStatus).toBe("QUARANTINED");
    expect(events[0]!.reason).toBe("suspicious row");
    // status change leaves the fact columns untouched
    expect(newest.priceCents).toBe(29800);

    const analysis = (
      await app.inject({
        method: "GET",
        url: "/v1/listings/amazon/B0TESTASIN/analysis",
      })
    ).json();
    expect(analysis.currentPriceCents).toBe(29900); // quarantined newest is skipped
    await app.close();
  });

  it("priceType USED rows are excluded from analysis", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const listing = await prisma.listing.findFirstOrThrow();
    await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        dataSourceId: await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST),
        priceCents: 100,
        priceType: "USED",
        currency: "USD",
        effectiveAt: new Date(Date.now() + 60_000), // would be "current" if eligible
        schemaVersion: 1,
        synthetic: false,
      },
    });
    const analysis = (
      await app.inject({
        method: "GET",
        url: "/v1/listings/amazon/B0TESTASIN/analysis",
      })
    ).json();
    expect(analysis.currentPriceCents).toBe(29900);
    expect(analysis.stats.observationCount).toBe(1);
    await app.close();
  });

  it("DB CHECK constraint rejects priceCents 0 (below the API layer)", async () => {
    const listing = await prisma.listing.create({
      data: {
        retailer: {
          connectOrCreate: {
            where: { id: "amazon" },
            create: { id: "amazon", displayName: "Amazon" },
          },
        },
        externalId: "B0CHECK000",
        url: "https://example.com",
        title: "t",
      },
    });
    await expect(
      prisma.priceObservation.create({
        data: {
          listingId: listing.id,
          dataSourceId: await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST),
          priceCents: 0,
          currency: "USD",
          effectiveAt: new Date(),
          schemaVersion: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("append-only trigger: fact-column update and delete are rejected", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const obs = await prisma.priceObservation.findFirstOrThrow();
    await expect(
      prisma.priceObservation.update({ where: { id: obs.id }, data: { priceCents: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.priceObservation.delete({ where: { id: obs.id } })).rejects.toThrow(
      /append-only/,
    );
    // status-only update still works
    await prisma.priceObservation.update({ where: { id: obs.id }, data: { status: "EXCLUDED" } });
    await app.close();
  });

  // ---- catalog identity (M2) -------------------------------------------------

  const GTIN_A = "0012345678905"; // valid 13-digit, normalizes to 00012345678905
  const GTIN_B = "036000291452"; // valid UPC-A, normalizes to 00036000291452

  const listingOf = async (retailerId: string, externalId: string) =>
    prisma.listing.findUniqueOrThrow({
      where: { retailerId_externalId: { retailerId, externalId } },
    });

  it("same valid GTIN across retailers → shared Product (EXACT auto-link)", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const l1 = await listingOf("amazon", "B0TESTASIN");

    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({
        retailer: "bestbuy",
        externalId: "7654321",
        url: "https://www.bestbuy.com/product/x/J3GWRW4HCC/sku/7654321",
      }),
    });
    const l2 = await listingOf("bestbuy", "7654321");
    expect(l2.productId).toBe(l1.productId);

    const ev = await prisma.matchEvidence.findMany({ where: { listingId: l2.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.level).toBe("EXACT");
    expect(ev[0]!.candidateProductId).toBe(l1.productId);
    expect(ev[0]!.engineVersion).toBe("1.0.0");

    const link = await prisma.productLinkEvent.findFirstOrThrow({
      where: { listingId: l2.id, action: "LINK" },
    });
    expect(link.actor).toBe("auto:match-engine@1.0.0");
    // the linked product gained the new listing's identifiers
    const ids = await prisma.productIdentifier.findMany({
      where: { productId: l1.productId! },
    });
    expect(ids.map((i) => i.type).sort()).toContainEqual("BESTBUY_SKU");
    await app.close();
  });

  it("no shared identifiers → separate products, UNRESOLVED evidence", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({
        externalId: "B0OTHERASIN",
        url: "https://www.amazon.com/dp/B0OTHERASIN",
        gtin: GTIN_B,
        modelNumber: "OTHER-9",
      }),
    });
    const l1 = await listingOf("amazon", "B0TESTASIN");
    const l2 = await listingOf("amazon", "B0OTHERASIN");
    expect(l2.productId).not.toBe(l1.productId);
    const ev = await prisma.matchEvidence.findMany({ where: { listingId: l2.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.level).toBe("UNRESOLVED");
    await app.close();
  });

  it("GTIN → product A, brand+model → product B → CONFLICT, own product", async () => {
    const app = await makeApp();
    // A: amazon listing asserting GTIN_A
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const a = await listingOf("amazon", "B0TESTASIN");
    // B: bestbuy listing asserting brand+model only
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({
        retailer: "bestbuy",
        externalId: "7654321",
        url: "https://www.bestbuy.com/product/x/J3GWRW4HCC/sku/7654321",
        gtin: undefined,
        brand: "Sony",
        modelNumber: "WH-1000XM6",
        title: "Sony Headphones",
      }),
    });
    const b = await listingOf("bestbuy", "7654321");
    expect(b.productId).not.toBe(a.productId);
    // C: asserts both GTIN_A and Sony/WH-1000XM6 → conflict
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({
        externalId: "B0CONFLICT0",
        url: "https://www.amazon.com/dp/B0CONFLICT0",
        brand: "Sony",
        modelNumber: "WH-1000XM6",
        title: "Sony Headphones",
      }),
    });
    const c = await listingOf("amazon", "B0CONFLICT0");
    expect(c.productId).not.toBe(a.productId);
    expect(c.productId).not.toBe(b.productId);
    const ev = await prisma.matchEvidence.findMany({ where: { listingId: c.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.level).toBe("CONFLICT");
    expect(ev[0]!.candidateProductId).toBeNull();
    await app.close();
  });

  it("linkListing/unlinkListing write ProductLinkEvent rows", async () => {
    const app = await makeApp();
    await app.inject({ method: "POST", url: "/v1/observations", payload: amazonObservation() });
    const listing = await listingOf("amazon", "B0TESTASIN");
    const original = listing.productId;

    const target = await prisma.product.create({
      data: { title: "Canonical", brand: "Acme" },
    });
    await linkListing(prisma, {
      listingId: listing.id,
      productId: target.id,
      reason: "same product",
      actor: "cli:tester",
    });
    expect((await listingOf("amazon", "B0TESTASIN")).productId).toBe(target.id);

    await unlinkListing(prisma, {
      listingId: listing.id,
      reason: "wrong product",
      actor: "cli:tester",
    });
    const after = await listingOf("amazon", "B0TESTASIN");
    expect(after.productId).not.toBe(target.id);
    expect(after.productId).not.toBe(original);

    const events = await prisma.productLinkEvent.findMany({
      where: { listingId: listing.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual(["LINK", "UNLINK"]);
    expect(events[0]!.previousProductId).toBe(original);
    expect(events[0]!.newProductId).toBe(target.id);
    expect(events[1]!.previousProductId).toBe(target.id);
    expect(events[1]!.newProductId).toBe(after.productId);
    expect(events.every((e) => e.actor === "cli:tester")).toBe(true);
    await app.close();
  });

  it("new assertion on an existing listing records evidence but never relinks", async () => {
    const app = await makeApp();
    // no GTIN on the first sighting so the original product isn't a candidate
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ gtin: undefined }),
    });
    const listing = await listingOf("amazon", "B0TESTASIN");
    const originalProduct = listing.productId;

    // another product holding GTIN_B
    const other = await prisma.product.create({
      data: { title: "Other", identifiers: { create: { type: "GTIN", value: "00036000291452" } } },
    });

    // second sighting asserts a new GTIN (different value → new assertion)
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      // different brand keeps the persisted AC-1 assertion a weak model_only
      // match against the original product (otherwise it would CONFLICT)
      payload: amazonObservation({
        priceCents: 28800,
        gtin: GTIN_B,
        modelNumber: "X-2",
        brand: "Sony",
      }),
    });
    const after = await listingOf("amazon", "B0TESTASIN");
    expect(after.productId).toBe(originalProduct); // never auto-relinked
    const ev = await prisma.matchEvidence.findMany({
      where: { listingId: listing.id },
      orderBy: { evaluatedAt: "asc" },
    });
    expect(ev.length).toBe(2); // creation evidence + re-evaluation
    expect(ev[1]!.level).toBe("EXACT");
    expect(ev[1]!.candidateProductId).toBe(other.id);
    await app.close();
  });

  it("invalid identifiers are asserted but never become ProductIdentifiers", async () => {
    const app = await makeApp();
    // bad check digit → valid: false on the GTIN assertion
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: amazonObservation({ gtin: "12345678901234" }),
    });
    const listing = await listingOf("amazon", "B0TESTASIN");
    const gtinAssertion = await prisma.identifierAssertion.findFirstOrThrow({
      where: { listingId: listing.id, type: "GTIN" },
    });
    expect(gtinAssertion.valid).toBe(false);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: listing.productId! },
      include: { identifiers: true },
    });
    expect(product.identifiers.map((i) => i.type).sort()).toEqual([
      "ASIN",
      "MANUFACTURER_MODEL",
    ]);
    await app.close();
  });
});
