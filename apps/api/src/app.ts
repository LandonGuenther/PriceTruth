import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { OBSERVATION_SCHEMA_VERSION } from "@pricetruth/shared";
import type { AppConfig } from "./config.js";
import {
  API_VERSION,
  API_VERSION_HEADER,
  OBSERVATION_SCHEMA_VERSION_HEADER,
} from "./apiVersion.js";
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

const INCOMING_REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  // Fastify's trustProxy type has no number; translate a hop count into a
  // predicate trusting the n proxies closest to this server.
  const trustProxy = opts.config.TRUST_PROXY;
  const app = Fastify({
    logger: false,
    requestTimeout: opts.config.REQUEST_TIMEOUT_MS,
    bodyLimit: opts.config.BODY_LIMIT_BYTES,
    trustProxy:
      typeof trustProxy === "number"
        ? (_addr: string, hop: number) => hop < trustProxy
        : trustProxy,
    // disableRequestLogging was dropped: deprecated in fastify 5.12 (FSTDEP023);
    // logger is off here and M4 wires request logging via logController.

    // Honour a client-supplied x-request-id (validated below), else generate one.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  app.decorate("prisma", opts.prisma);
  app.decorate("config", opts.config);
  app.decorate("fetchImpl", opts.fetchImpl);

  const allowedExtensionIds = opts.config.ALLOWED_EXTENSION_IDS
    ? new Set(opts.config.ALLOWED_EXTENSION_IDS)
    : null;
  if (
    !allowedExtensionIds &&
    (opts.config.NODE_ENV === "staging" || opts.config.NODE_ENV === "production")
  ) {
    app.log.warn("ALLOWED_EXTENSION_IDS unset: any chrome-extension:// origin is allowed");
  }

  const extraOrigins = new Set(
    (opts.config.CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser callers (no Origin header) are always allowed.
      if (!origin) return cb(null, true);
      try {
        const url = new URL(origin);
        if (url.protocol === "chrome-extension:") {
          // Unset → any extension; set → only the listed extension ids.
          return cb(null, allowedExtensionIds === null || allowedExtensionIds.has(url.host));
        }
      } catch {
        /* fall through */
      }
      return cb(null, extraOrigins.has(origin));
    },
  });

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => {
      const err = new Error(`Rate limit exceeded, retry in ${context.after}`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 429;
      err.code = "rate_limited";
      (err as unknown as Record<string, unknown>).retryAfterSeconds = Math.ceil(context.ttl / 1000);
      return err;
    },
  });

  // Version + request-id headers on every response.
  app.addHook("onRequest", async (request) => {
    if (!INCOMING_REQUEST_ID_RE.test(request.id)) request.id = randomUUID();
  });
  app.addHook("onSend", async (request, reply) => {
    void reply
      .header(API_VERSION_HEADER, String(API_VERSION))
      .header(OBSERVATION_SCHEMA_VERSION_HEADER, String(OBSERVATION_SCHEMA_VERSION))
      .header("x-request-id", request.id);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not_found", message: "Unknown route" });
  });

  app.setErrorHandler((error: FastifyError | ObservationRejected, _request, reply) => {
    if (error instanceof ObservationRejected) {
      return reply.status(400).send({ error: "invalid_observation", message: error.message });
    }
    const status = error.statusCode ?? 500;
    app.log.error(error);
    if (status === 429) {
      const retryAfterSeconds = Math.max(
        0,
        Math.ceil(
          ((error as unknown as { retryAfterSeconds?: number }).retryAfterSeconds ?? 0) || 0,
        ),
      );
      return reply.status(429).send({
        error: "rate_limited",
        message: error.message,
        retryAfterSeconds,
      });
    }
    if (status >= 500) {
      // Never leak internals in a 5xx body.
      return reply.status(500).send({ error: "internal_error", message: "Internal error" });
    }
    return reply.status(status).send({ error: "request_error", message: error.message });
  });

  healthRoutes(app);
  observationRoutes(app);
  listingRoutes(app);

  return app;
}
