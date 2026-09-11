/**
 * Adversarial input tests: malformed bodies, out-of-range values, injection,
 * XSS storage/response hygiene, 5xx sanitization, rate limiting, and a check
 * that no secrets or HTML-injection sinks live in the extension bundle.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import {
  amazonObservation,
  describeIfDb,
  makeApp,
  prisma,
  testConfig,
  truncateAll,
} from "./helpers.js";

// Unique externalId: test files run in parallel against one DB, so
// row-count assertions are always scoped to this id.
const SEC_ASIN = "B0SECASIN1";
const secObs = (overrides: Parameters<typeof amazonObservation>[0] = {}) =>
  amazonObservation({
    externalId: SEC_ASIN,
    url: `https://www.amazon.com/dp/${SEC_ASIN}`,
    ...overrides,
  });
const secListingCount = () => prisma.listing.count({ where: { externalId: SEC_ASIN } });
const secObsCount = async () => {
  const l = await prisma.listing.findUnique({
    where: { retailerId_externalId: { retailerId: "amazon", externalId: SEC_ASIN } },
  });
  return l ? prisma.priceObservation.count({ where: { listingId: l.id } }) : 0;
};

const post = (app: Awaited<ReturnType<typeof makeApp>>, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/observations", payload });

describeIfDb("adversarial request handling", () => {
  beforeEach(truncateAll);

  describe("malformed bodies", () => {
    it("truncated JSON body → 400", async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/observations",
        headers: { "content-type": "application/json" },
        payload: '{"a":',
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("text/plain content-type with JSON body → 4xx", async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/observations",
        headers: { "content-type": "text/plain" },
        payload: JSON.stringify(amazonObservation()),
      });
      expect([400, 415]).toContain(res.statusCode);
      await app.close();
    });
  });

  describe("size limits", () => {
    it("body of ~70 KiB → 413", async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/observations",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ ...secObs(), junk: "x".repeat(70 * 1024) }),
      });
      expect(res.statusCode).toBe(413);
      await app.close();
    });

    it("title of 5,000 chars → 400", async () => {
      const app = await makeApp();
      const res = await post(app, secObs({ title: "x".repeat(5000) }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("variant with 200 keys → 400", async () => {
      const variant = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, "v"]));
      const app = await makeApp();
      const res = await post(app, secObs({ variant }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("variant value of 5,000 chars → 400", async () => {
      const app = await makeApp();
      const res = await post(app, secObs({ variant: { color: "v".repeat(5000) } }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("nested object as variant value → 400", async () => {
      const app = await makeApp();
      const res = await post(app, secObs({ variant: { color: { nested: "x" } } as never }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("numeric coercion", () => {
    it.each([0, -1, 1.5, 2147483648, 2 ** 53 + 1, "100"])(
      "priceCents %s → 400",
      async (priceCents) => {
        const app = await makeApp();
        const res = await post(app, secObs({ priceCents: priceCents as never }));
        expect(res.statusCode).toBe(400);
        await app.close();
      },
    );

    it("referencePriceCents <= priceCents → 400", async () => {
      const app = await makeApp();
      const res = await post(app, secObs({ priceCents: 29900, referencePriceCents: 29900 }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("currency", () => {
    it.each(["usd", "US", "USDD", "U$D"])("currency %s → 400", async (currency) => {
      const app = await makeApp();
      const res = await post(app, secObs({ currency }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("time policy", () => {
    it("observedAt +1h in future → rejected, no row", async () => {
      const app = await makeApp();
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await post(app, secObs({ observedAt: future }));
      expect(res.statusCode).toBe(400);
      expect(await secObsCount()).toBe(0);
      expect(await secListingCount()).toBe(0);
      await app.close();
    });

    it("observedAt 8 days old → rejected, no row", async () => {
      const app = await makeApp();
      const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const res = await post(app, secObs({ observedAt: old }));
      expect(res.statusCode).toBe(400);
      expect(await secObsCount()).toBe(0);
      expect(await secListingCount()).toBe(0);
      await app.close();
    });
  });

  describe("retailer / host / identifier validation", () => {
    it("unknown retailer → 400", async () => {
      const app = await makeApp();
      const res = await post(app, secObs({ retailer: "walmart" as never }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it.each([
      "https://amazon.com.evil.example/dp/B000000001",
      "https://evil.example/?u=amazon.com",
    ])("url %s → 400", async (url) => {
      const app = await makeApp();
      const res = await post(app, secObs({ url }));
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it.each(["b000000001", "B00000001"])("ASIN %s → 400", async (externalId) => {
      const app = await makeApp();
      const res = await post(
        app,
        secObs({ externalId, url: `https://www.amazon.com/dp/${externalId}` }),
      );
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("bestbuy externalId 'abc' → 400", async () => {
      const app = await makeApp();
      const res = await post(
        app,
        secObs({
          retailer: "bestbuy",
          externalId: "abc",
          url: "https://www.bestbuy.com/site/x/abc.p",
        }),
      );
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("XSS storage hygiene", () => {
    it("markup title is stored verbatim and served as JSON", async () => {
      const app = await makeApp();
      const title = "<img src=x onerror=alert(1)><script>alert(1)</script>";
      const res = await post(app, secObs({ title }));
      expect([200, 201]).toContain(res.statusCode);
      const body = res.json() as { listingId?: string };
      expect(body.listingId).toBeTruthy();

      const listing = await prisma.listing.findUniqueOrThrow({
        where: { retailerId_externalId: { retailerId: "amazon", externalId: SEC_ASIN } },
      });
      expect(listing.title).toBe(title);

      const hist = await app.inject({
        method: "GET",
        url: `/v1/listings/${listing.retailerId}/${listing.externalId}/history`,
      });
      expect(hist.statusCode).toBe(200);
      expect(hist.headers["content-type"]).toContain("application/json");
      expect(hist.body).not.toContain("text/html");
      await app.close();
    });

    it("extension source has no HTML-injection sinks", () => {
      const extSrc = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../extension/src",
      );
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = path.join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(ts|tsx|js|jsx)$/.test(f)) files.push(p);
        }
      };
      walk(extSrc);
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
        expect(src, f).not.toMatch(/\.innerHTML\s*=[^=]/);
      }
    });
  });

  describe("injection payloads", () => {
    it("SQL-like title stores verbatim; injected path segment is inert", async () => {
      const app = await makeApp();
      const sqlTitle = `'; DROP TABLE "PriceObservation"; --`;
      const res = await post(app, secObs({ title: sqlTitle }));
      expect([200, 201]).toContain(res.statusCode);
      const listing = await prisma.listing.findUniqueOrThrow({
        where: { retailerId_externalId: { retailerId: "amazon", externalId: SEC_ASIN } },
      });
      expect(listing.title).toBe(sqlTitle);

      const probe = await app.inject({
        method: "GET",
        url: `/v1/listings/amazon/${SEC_ASIN}'%20OR%201=1--/history`,
      });
      expect([200, 400, 404]).toContain(probe.statusCode);

      expect(await secObsCount()).toBe(1);
      await expect(
        prisma.$queryRawUnsafe('SELECT count(*) FROM "PriceObservation"'),
      ).resolves.toBeTruthy();
      await app.close();
    });
  });

  describe("5xx sanitization", () => {
    it("internal error body is generic", async () => {
      const stub = {
        listing: {
          findUnique: async () => {
            throw new Error("secret internal detail");
          },
        },
      } as unknown as PrismaClient;
      const app = await buildApp({ prisma: stub, config: testConfig() });
      const res = await app.inject({
        method: "GET",
        url: "/v1/listings/amazon/B000000001/history",
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "internal_error", message: "Internal error" });
      expect(res.body).not.toContain("secret internal detail");
      await app.close();
    });
  });

  describe("rate limiting", () => {
    it("read class: 241st GET analysis from one address → 429", async () => {
      const app = await makeApp();
      const addr = "10.9.9.9";
      let last = 0;
      for (let i = 0; i < 241; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/listings/amazon/B000000001/analysis",
          remoteAddress: addr,
        });
        last = res.statusCode;
      }
      expect(last).toBe(429);
      const res = await app.inject({
        method: "GET",
        url: "/v1/listings/amazon/B000000001/analysis",
        remoteAddress: addr,
      });
      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.error).toBe("rate_limited");
      expect(typeof body.retryAfterSeconds).toBe("number");
      await app.close();
    });

    it("ingest class: 61st POST observations from one address → 429", async () => {
      const app = await makeApp();
      const addr = "10.8.8.8";
      let last = 0;
      for (let i = 0; i < 61; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/observations",
          remoteAddress: addr,
          payload: { schemaVersion: 999 },
        });
        last = res.statusCode;
      }
      expect(last).toBe(429);
      await app.close();
    });

    it("health class: 601st GET /health from one address → 429", async () => {
      const app = await makeApp();
      const addr = "10.7.7.7";
      let last = 0;
      for (let i = 0; i < 601; i++) {
        const res = await app.inject({ method: "GET", url: "/health", remoteAddress: addr });
        last = res.statusCode;
      }
      expect(last).toBe(429);
      await app.close();
    });
  });
});

describe("extension bundle secrets scan", () => {
  const distDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../extension/dist",
  );

  it("dist contains no API keys, connection strings, or token-like secrets", () => {
    execSync("pnpm --filter @pricetruth/extension build", { stdio: "ignore" });
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(distDir);
    const secretRe = /(key|secret|token|password)["'=: ]{1,10}["']?[A-Za-z0-9+/=-]{32,}/i;
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      expect(content, f).not.toContain("BESTBUY_API_KEY");
      expect(content, f).not.toContain("DATABASE_URL");
      expect(content, f).not.toContain("postgres://");
      expect(content, f).not.toMatch(secretRe);
    }
  });
});
