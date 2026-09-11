import type { FastifyInstance } from "fastify";
import {
  CLIENT_VERSION_HEADER,
  OBSERVATION_SCHEMA_VERSION,
  retailerObservationSchema,
} from "@pricetruth/shared";
import { ingestObservation } from "../services/observationService.js";
import { API_VERSION } from "../apiVersion.js";

export function observationRoutes(app: FastifyInstance): void {
  app.post(
    "/v1/observations",
    {
      config: {
        rateLimit: {
          max: app.config.RATE_LIMIT_INGEST_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
        // Logged for observability only — not stored (see docs/IDEMPOTENCY.md).
        request.log.info({ idempotencyKey }, "idempotency key supplied");
      }
      const body = request.body as { schemaVersion?: unknown } | undefined;
      if (
        typeof body?.schemaVersion === "number" &&
        body.schemaVersion !== OBSERVATION_SCHEMA_VERSION
      ) {
        return reply.status(400).send({
          error: "unsupported_schema_version",
          message: `schemaVersion ${body.schemaVersion} is not supported (expected ${OBSERVATION_SCHEMA_VERSION})`,
        });
      }
      if (body?.schemaVersion === undefined) {
        return reply.status(400).send({
          error: "invalid_observation",
          message: "schemaVersion is required",
        });
      }

      const parsed = retailerObservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_observation",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }

      const result = await ingestObservation(
        app.prisma,
        app.config,
        parsed.data,
        {
          clientVersion: (request.headers[CLIENT_VERSION_HEADER] as string | undefined) ?? null,
        },
        app.fetchImpl,
      );

      return reply.status(result.accepted ? 201 : 200).send({ ...result, apiVersion: API_VERSION });
    },
  );
}
