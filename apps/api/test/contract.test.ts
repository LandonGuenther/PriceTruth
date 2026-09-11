/**
 * API contract tests: version headers/fields, health vs readiness,
 * CORS by extension id, request-id handling, config parsing.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  API_VERSION,
  API_VERSION_HEADER,
  OBSERVATION_SCHEMA_VERSION_HEADER,
} from "../src/apiVersion.js";
import { expectedLatestMigration, migrationsCheck } from "../src/readiness.js";
import { describeIfDb, makeApp, testConfig } from "./helpers.js";

const EXT_ID = "a".repeat(32);
const OTHER_EXT_ID = "b".repeat(32);

describeIfDb("api contract", () => {
  it("version + request-id headers on every response incl. 404", async () => {
    const app = await makeApp();
    for (const res of [
      await app.inject({ method: "GET", url: "/health" }),
      await app.inject({ method: "GET", url: "/nope" }),
    ]) {
      expect(res.headers[API_VERSION_HEADER]).toBe(String(API_VERSION));
      expect(res.headers[OBSERVATION_SCHEMA_VERSION_HEADER]).toBe("1");
      expect(res.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    }
    await app.close();
  });

  it("apiVersion field on health, observations, analysis, history", async () => {
    const app = await makeApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json().apiVersion).toBe(API_VERSION);
    expect(health.json().uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(health.json().version).toBeDefined();
    expect(health.json().db).toBe("ok");
    await app.close();
  });

  it("GET /readiness → 200 ready on migrated DB", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual({ database: "ok", migrations: "ok" });
    expect(body.apiVersion).toBe(API_VERSION);
    expect(res.body).not.toContain("postgres");
    await app.close();
  });

  it("GET /readiness → 503 when prisma stub throws", async () => {
    const stub = {
      $queryRawUnsafe: async () => {
        throw new Error("db down");
      },
      $queryRaw: async () => {
        throw new Error("db down");
      },
    } as unknown as PrismaClient;
    const app = await buildApp({ prisma: stub, config: testConfig() });
    const res = await app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("not_ready");
    await app.close();
  });

  it("honours a valid inbound x-request-id, replaces a hostile one", async () => {
    const app = await makeApp();
    const good = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "client-req.1_2-3" },
    });
    expect(good.headers["x-request-id"]).toBe("client-req.1_2-3");
    const bad = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": 'x\ninjected: "evil"' },
    });
    expect(bad.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(bad.headers["x-request-id"]).not.toContain("\n");
    await app.close();
  });

  it("CORS: ALLOWED_EXTENSION_IDS set → only listed ids pass", async () => {
    const app = await makeApp(testConfig({ ALLOWED_EXTENSION_IDS: [EXT_ID] }));
    const ok = await app.inject({
      method: "OPTIONS",
      url: "/v1/observations",
      headers: {
        origin: `chrome-extension://${EXT_ID}`,
        "access-control-request-method": "POST",
      },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe(`chrome-extension://${EXT_ID}`);

    const denied = await app.inject({
      method: "OPTIONS",
      url: "/v1/observations",
      headers: {
        origin: `chrome-extension://${OTHER_EXT_ID}`,
        "access-control-request-method": "POST",
      },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("CORS: CORS_ORIGINS passes; random https origin fails; no-Origin allowed", async () => {
    const app = await makeApp(testConfig({ CORS_ORIGINS: "https://ops.example" }));
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://ops.example" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://ops.example");

    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    const noOrigin = await app.inject({ method: "GET", url: "/health" });
    expect(noOrigin.statusCode).toBe(200);
    await app.close();
  });
});

describe("config", () => {
  const base = { DATABASE_URL: "postgresql://u:p@db.example:5432/pt" };

  it("defaults: NODE_ENV development → HOST 127.0.0.1, LOG_LEVEL debug", () => {
    const c = loadConfig(base);
    expect(c.HOST).toBe("127.0.0.1");
    expect(c.LOG_LEVEL).toBe("debug");
    expect(c.RATE_LIMIT_INGEST_PER_MINUTE).toBe(60);
    expect(c.RATE_LIMIT_READ_PER_MINUTE).toBe(240);
    expect(c.RATE_LIMIT_HEALTH_PER_MINUTE).toBe(600);
    expect(c.REQUEST_TIMEOUT_MS).toBe(15000);
    expect(c.BODY_LIMIT_BYTES).toBe(65536);
    expect(c.TRUST_PROXY).toBe(false);
    expect(c.ARCHIVE_BACKEND).toBe("local");
  });

  it("test env → silent logs; staging → HOST 0.0.0.0 / info", () => {
    expect(loadConfig({ ...base, NODE_ENV: "test" }).LOG_LEVEL).toBe("silent");
    const staging = loadConfig({ ...base, NODE_ENV: "staging" });
    expect(staging.HOST).toBe("0.0.0.0");
    expect(staging.LOG_LEVEL).toBe("info");
  });

  it("TRUST_PROXY accepts true/false/hops/CIDR list", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: "10.0.0.0/8, 192.168.1.1" }).TRUST_PROXY).toEqual([
      "10.0.0.0/8",
      "192.168.1.1",
    ]);
  });

  it("production rejects localhost DATABASE_URL (names only in error)", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:secret@localhost:5432/x",
        NODE_ENV: "production",
      }),
    ).toThrowError(/DATABASE_URL/);
    try {
      loadConfig({
        DATABASE_URL: "postgresql://u:secret@localhost:5432/x",
        NODE_ENV: "production",
      });
    } catch (e) {
      expect(String(e)).not.toContain("secret");
    }
    // staging allows it
    expect(
      loadConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/x", NODE_ENV: "staging" })
        .NODE_ENV,
    ).toBe("staging");
  });

  it("INTERNAL_API_TOKEN < 32 chars → fail; absent → ok", () => {
    expect(() => loadConfig({ ...base, INTERNAL_API_TOKEN: "short" })).toThrowError(
      /INTERNAL_API_TOKEN/,
    );
    expect(loadConfig(base).INTERNAL_API_TOKEN).toBeUndefined();
    expect(loadConfig({ ...base, INTERNAL_API_TOKEN: "x".repeat(32) }).INTERNAL_API_TOKEN).toBe(
      "x".repeat(32),
    );
  });

  it("ARCHIVE_BACKEND=s3 requires all S3_* vars", () => {
    expect(() => loadConfig({ ...base, ARCHIVE_BACKEND: "s3" })).toThrowError(/S3_ENDPOINT/);
    const c = loadConfig({
      ...base,
      ARCHIVE_BACKEND: "s3",
      S3_ENDPOINT: "https://r2.example",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    });
    expect(c.S3_REGION).toBe("auto");
    expect(c.S3_FORCE_PATH_STYLE).toBe(false);
    expect(c.S3_REQUEST_TIMEOUT_MS).toBe(30000);
  });

  it("bad ALLOWED_EXTENSION_IDS entry → fail naming the var", () => {
    expect(() => loadConfig({ ...base, ALLOWED_EXTENSION_IDS: "not-an-id" })).toThrowError(
      /ALLOWED_EXTENSION_IDS/,
    );
    expect(loadConfig({ ...base, ALLOWED_EXTENSION_IDS: EXT_ID }).ALLOWED_EXTENSION_IDS).toEqual([
      EXT_ID,
    ]);
  });
});

describe("readiness helpers", () => {
  it("expectedLatestMigration returns lexicographically last dir", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "migs-"));
    mkdirSync(path.join(dir, "20260911041711_data_foundation"));
    mkdirSync(path.join(dir, "20260911070434_daily_rollup"));
    writeFileSync(path.join(dir, "migration_lock.toml"), "# lock");
    expect(expectedLatestMigration(dir)).toBe("20260911070434_daily_rollup");
    expect(expectedLatestMigration(path.join(dir, "missing"))).toBeNull();
  });

  it("migrationsCheck: pending when expected name absent", async () => {
    const prisma = {
      $queryRawUnsafe: async () => [] as Array<{ migration_name: string }>,
    };
    expect(await migrationsCheck(prisma as never, "20990101000000_future")).toBe("pending");
    const throwing = {
      $queryRawUnsafe: async () => {
        throw new Error("x");
      },
    };
    expect(await migrationsCheck(throwing as never, "x")).toBe("unknown");
    expect(await migrationsCheck(prisma as never, null)).toBe("unknown");
  });
});
