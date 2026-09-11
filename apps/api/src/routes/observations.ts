import type { FastifyInstance } from "fastify";
import { CLIENT_VERSION_HEADER, retailerObservationSchema } from "@pricetruth/shared";
import { ingestObservation, userAgentHash } from "../services/observationService.js";

export function observationRoutes(app: FastifyInstance): void {
  app.post("/v1/observations", async (request, reply) => {
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
        userAgentHash: userAgentHash(request.headers["user-agent"]),
      },
      app.fetchImpl,
    );

    return reply.status(result.accepted ? 201 : 200).send(result);
  });
}
