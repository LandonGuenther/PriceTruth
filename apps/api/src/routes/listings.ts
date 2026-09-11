import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyzeListingRow,
  defaultHistoryRepository,
  findListing,
  listingHistory,
} from "../services/analysisService.js";
import { API_VERSION } from "../apiVersion.js";

const paramsSchema = z.object({ retailer: z.string(), externalId: z.string().min(1) });
const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(730).default(180),
});

export function listingRoutes(app: FastifyInstance): void {
  const rateLimit = {
    max: app.config.RATE_LIMIT_READ_PER_MINUTE,
    timeWindow: "1 minute",
  };

  app.get(
    "/v1/listings/:retailer/:externalId/analysis",
    { config: { rateLimit } },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(404).send({ error: "listing_not_found", message: "Unknown listing" });
      }
      const listing = await findListing(app.prisma, params.data.retailer, params.data.externalId);
      if (!listing) {
        return reply.status(404).send({ error: "listing_not_found", message: "Unknown listing" });
      }
      return {
        ...(await analyzeListingRow(defaultHistoryRepository(app.prisma), listing)),
        apiVersion: API_VERSION,
      };
    },
  );

  app.get(
    "/v1/listings/:retailer/:externalId/history",
    { config: { rateLimit } },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(404).send({ error: "listing_not_found", message: "Unknown listing" });
      }
      const query = historyQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ error: "invalid_query", message: "days must be an integer between 1 and 730" });
      }
      const listing = await findListing(app.prisma, params.data.retailer, params.data.externalId);
      if (!listing) {
        return reply.status(404).send({ error: "listing_not_found", message: "Unknown listing" });
      }
      return {
        ...(await listingHistory(defaultHistoryRepository(app.prisma), listing, query.data.days)),
        apiVersion: API_VERSION,
      };
    },
  );
}
