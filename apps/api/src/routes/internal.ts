import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { getOpsStatus } from "../ops.js";

/**
 * Constant-time token compare (hashed so lengths don't leak via timing).
 * 404 (not 401) for missing/invalid token to reduce endpoint discoverability.
 */
function authorized(authHeader: string | undefined, token: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const a = createHash("sha256").update(authHeader.slice(7)).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

export function registerInternalRoutes(
  app: FastifyInstance,
  prisma: Parameters<typeof getOpsStatus>[0],
  config: AppConfig,
) {
  app.get("/internal/metrics", async (request, reply) => {
    if (request.query && (request.query as { format?: string }).format === "prometheus") {
      return reply
        .header("content-type", "text/plain; version=0.0.4")
        .send(app.metrics.toPrometheus());
    }
    return app.metrics.snapshot();
  });

  app.get("/internal/status", async (request, reply) => {
    if (!config.INTERNAL_API_TOKEN) return reply.code(404).send({ error: "not_found" });
    if (!authorized(request.headers.authorization, config.INTERNAL_API_TOKEN))
      return reply.code(404).send({ error: "not_found" });
    return getOpsStatus(prisma);
  });
}
