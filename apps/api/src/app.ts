import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { LogController, type FastifyError, type FastifyInstance } from "fastify";
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
import { metrics, type Metrics } from "./metrics.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { CLIENT_VERSION_HEADER } from "@pricetruth/shared";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    fetchImpl: FetchLike | undefined;
    metrics: Metrics;
  }
  interface FastifyRequest {
    /** Set by the ingest route so the access log can report the outcome. */
    ingestOutcome: string | undefined;
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
    logger: {
      level: opts.config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "*.DATABASE_URL",
          "*.S3_SECRET_ACCESS_KEY",
          "*.password",
        ],
        remove: true,
      },
    },
    // disableRequestLogging is deprecated in fastify 5.12; LogController is the
    // non-deprecated equivalent. Only our onResponse hook emits a request line.
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: opts.config.REQUEST_TIMEOUT_MS,
    bodyLimit: opts.config.BODY_LIMIT_BYTES,
    forceCloseConnections: "idle",
    trustProxy:
      typeof trustProxy === "number"
        ? (_addr: string, hop: number) => hop < trustProxy
        : trustProxy,
    // Honour a client-supplied x-request-id (validated below), else generate one.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  app.decorate("prisma", opts.prisma);
  app.decorate("config", opts.config);
  app.decorate("fetchImpl", opts.fetchImpl);
  app.decorate("metrics", metrics);

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
      .header("x-request-id", request.id)
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer");
    if (
      request.routeOptions?.url?.startsWith("/v1") ||
      request.routeOptions?.url?.startsWith("/internal")
    ) {
      void reply.header("cache-control", "no-store");
    }
  });

  // Single access-log line + request metrics per completed request.
  app.addHook("onResponse", async (request, reply) => {
    const operation = request.routeOptions?.url ?? "not_found";
    const durationMs = Math.round(reply.elapsedTime * 10) / 10;
    const params = request.params as { retailer?: string } | undefined;
    const body = request.body as { retailer?: string } | null | undefined;
    const retailer = params?.retailer ?? body?.retailer;
    const outcome = request.ingestOutcome ?? (reply.statusCode >= 400 ? "error" : "ok");

    metrics.inc("requests_total", {
      operation,
      status: String(reply.statusCode),
    });
    metrics.observe(operation, durationMs);
    if (request.ingestOutcome)
      metrics.inc("observations_total", { outcome: request.ingestOutcome });

    request.log.info(
      {
        requestId: request.id,
        operation,
        method: request.method,
        statusCode: reply.statusCode,
        durationMs,
        retailer,
        clientVersion: request.headers[CLIENT_VERSION_HEADER],
        outcome,
      },
      "request",
    );
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not_found", message: "Unknown route" });
  });

  app.setErrorHandler((error: FastifyError | ObservationRejected, _request, reply) => {
    if (error instanceof ObservationRejected) {
      return reply.status(400).send({ error: "invalid_observation", message: error.message });
    }
    const status = error.statusCode ?? 500;
    // 5xx → error; 4xx/429 → warn with code/status/message only.
    if (status >= 500) app.log.error(error);
    else
      app.log.warn({
        code: (error as FastifyError).code,
        statusCode: status,
        message: error.message,
      });
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
  registerInternalRoutes(app, opts.prisma, opts.config);

  return app;
}
