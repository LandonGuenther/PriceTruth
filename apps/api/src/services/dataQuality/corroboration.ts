import type { PrismaClient } from "@prisma/client";
import { setObservationStatus } from "../observationService.js";

export const CORROBORATION_ENGINE_VERSION = "1.0.0";
const CORROBORATION_ACTOR = `system:corroboration@${CORROBORATION_ENGINE_VERSION}`;
const WINDOW_MS = 30 * 86_400_000;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function agrees(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) <= 0.01;
}

/**
 * Idempotent corroboration pass for one listing. A non-synthetic row in status
 * ACCEPTED or QUARANTINED (last 30 days) becomes CORROBORATED when another
 * non-synthetic, non-EXCLUDED row for the same listing agrees on price within
 * 1% AND is either from a different DataSource or on a different UTC day
 * (effectiveAt). QUARANTINED→CORROBORATED is the self-heal path. EXCLUDED rows
 * are never touched.
 */
export async function corroborateListing(
  prisma: PrismaClient,
  listingId: string,
  now: Date,
): Promise<void> {
  const rows = await prisma.priceObservation.findMany({
    where: {
      listingId,
      synthetic: false,
      effectiveAt: { gte: new Date(now.getTime() - WINDOW_MS) },
    },
    select: {
      id: true,
      status: true,
      priceCents: true,
      dataSourceId: true,
      effectiveAt: true,
    },
  });

  const eligible = rows.filter((r) => r.status === "ACCEPTED" || r.status === "QUARANTINED");
  for (const row of eligible) {
    const corroborator = rows.find(
      (other) =>
        other.id !== row.id &&
        other.status !== "EXCLUDED" &&
        agrees(row.priceCents, other.priceCents) &&
        (other.dataSourceId !== row.dataSourceId ||
          utcDay(other.effectiveAt) !== utcDay(row.effectiveAt)),
    );
    if (!corroborator) continue;
    await setObservationStatus(
      prisma,
      row.id,
      "CORROBORATED",
      `corroborated by observation ${corroborator.id}`,
      CORROBORATION_ACTOR,
    );
  }
}
