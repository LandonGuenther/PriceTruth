import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { analyzeListingRow, findListing, listingHistory } from "../services/analysisService.js";

const paramsSchema = z.object({ retailer: z.string(), externalId: z.string().min(1) });
const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(730).default(180),
});

export function listingRoutes(app: FastifyInstance): void {
  app.get("/v1/listings/:retailer/:externalId/analysis", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(404).send({ error: "listing_not_found", message: "Unknown listing" });
    }
    const listing = await findListing(app.prisma, params.data.retailer, params.data.externalId);
    if (!listing) {
      return reply.status(404).send({ error: "listing_not_found", message: "Unknown listing" });
    }
    return analyzeListingRow(app.prisma, listing);
  });

  app.get("/v1/listings/:retailer/:externalId/history", async (request, reply) => {
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
    return listingHistory(listing, query.data.days);
  });
}
