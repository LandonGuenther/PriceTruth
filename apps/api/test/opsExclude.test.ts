/** DB-backed test for the `pnpm ops exclude` owner-correction helper. */
import { beforeEach, expect, it } from "vitest";
import { dataSourceId, describeIfDb, prisma, truncateAll } from "./helpers.js";
import { excludeObservation } from "../src/ops.js";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";

describeIfDb("ops exclude", () => {
  beforeEach(truncateAll);

  it("flips ACCEPTED → EXCLUDED with a status event, then refuses", async () => {
    const listing = await prisma.listing.create({
      data: {
        retailer: {
          connectOrCreate: {
            where: { id: "amazon" },
            create: { id: "amazon", displayName: "Amazon" },
          },
        },
        externalId: "B0EXCLUDE1",
        url: "https://www.amazon.com/dp/B0EXCLUDE1",
        title: "Exclude Widget",
      },
    });
    const obs = await prisma.priceObservation.create({
      data: {
        listingId: listing.id,
        dataSourceId: await dataSourceId(OBSERVATION_SOURCES.SYNTHETIC_TEST),
        priceCents: 1000,
        currency: "USD",
        schemaVersion: 1,
        effectiveAt: new Date(),
        synthetic: true,
      },
    });

    const out = await excludeObservation(prisma, obs.id, "wrong price (test)");
    expect(out).toEqual({ id: obs.id.toString(), before: "ACCEPTED", after: "EXCLUDED" });
    const event = await prisma.observationStatusEvent.findFirstOrThrow({
      where: { observationId: obs.id },
      orderBy: { id: "desc" },
    });
    expect(event).toMatchObject({
      fromStatus: "ACCEPTED",
      toStatus: "EXCLUDED",
      reason: "wrong price (test)",
      actor: "owner-cli",
    });

    await expect(excludeObservation(prisma, obs.id, "again")).rejects.toThrow("already EXCLUDED");
    expect(await prisma.observationStatusEvent.count({ where: { observationId: obs.id } })).toBe(1);
  });
});
