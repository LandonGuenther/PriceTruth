import type { PrismaClient } from "@prisma/client";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { listingRoutes } from "./routes/listings.js";
import { observationRoutes } from "./routes/observations.js";
import { ObservationRejected } from "./services/observationService.js";
import type { FetchLike } from "./services/bestbuyApi.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    fetchImpl: FetchLike | undefined;
  }
}

export interface BuildAppOptions {
  prisma: PrismaClient;
  config: AppConfig;
  fetchImpl?: FetchLike;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("prisma", opts.prisma);
  app.decorate("config", opts.config);
  app.decorate("fetchImpl", opts.fetchImpl);

  const extraOrigins = new Set(
    (opts.config.CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser callers (no Origin header) and the extension's service
      // worker (chrome-extension:// scheme) are always allowed.
      if (!origin) return cb(null, true);
      try {
        if (new URL(origin).protocol === "chrome-extension:") return cb(null, true);
      } catch {
        /* fall through */
      }
      return cb(null, extraOrigins.has(origin));
    },
  });

  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not_found", message: "Unknown route" });
  });

  app.setErrorHandler((error: FastifyError | ObservationRejected, _request, reply) => {
    if (error instanceof ObservationRejected) {
      return reply.status(400).send({ error: "invalid_observation", message: error.message });
    }
    const status = error.statusCode ?? 500;
    app.log.error(error);
    return reply
      .status(status)
      .send({ error: status >= 500 ? "internal_error" : "request_error", message: error.message });
  });

  healthRoutes(app);
  observationRoutes(app);
  listingRoutes(app);

  return app;
}
