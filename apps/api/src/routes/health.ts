import type { FastifyInstance } from "fastify";
import { PRODUCT_NAME } from "@pricetruth/shared";

export function healthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => {
    let db: "ok" | "error" = "ok";
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "error";
    }
    return { status: "ok", product: PRODUCT_NAME, db };
  });
}
