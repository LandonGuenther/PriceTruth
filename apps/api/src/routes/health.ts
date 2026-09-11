import type { FastifyInstance } from "fastify";
import { PRODUCT_NAME } from "@pricetruth/shared";
import { API_VERSION } from "../apiVersion.js";
import { databaseCheck, expectedLatestMigration, migrationsCheck } from "../readiness.js";

const startedAt = Date.now();

export function healthRoutes(app: FastifyInstance): void {
  const rateLimit = {
    max: app.config.RATE_LIMIT_HEALTH_PER_MINUTE,
    timeWindow: "1 minute",
  };

  // Liveness: always 200 while the process is up; never fails on db errors.
  app.get("/health", { config: { rateLimit } }, async () => {
    let db: "ok" | "error" = "ok";
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "error";
    }
    return {
      status: "ok",
      product: PRODUCT_NAME,
      db,
      apiVersion: API_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: process.env.APP_VERSION ?? "dev",
    };
  });

  // Readiness: 200 only when the DB is reachable and migrations are current.
  app.get("/readiness", { config: { rateLimit } }, async (_request, reply) => {
    const [database, migrations] = await Promise.all([
      databaseCheck(app.prisma),
      migrationsCheck(app.prisma, expectedLatestMigration()),
    ]);
    const ready = database === "ok" && migrations === "ok";
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      checks: { database, migrations },
      apiVersion: API_VERSION,
    });
  });
}
