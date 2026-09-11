/**
 * Ops CLI — read-only inspection. All output is JSON (BigInt ids as strings).
 *
 *   pnpm --filter @pricetruth/api ops status
 *   pnpm --filter @pricetruth/api ops recent [--limit N]
 *   pnpm --filter @pricetruth/api ops listing <retailer> <externalId>
 *   pnpm --filter @pricetruth/api ops quarantined [--limit N]
 *   pnpm --filter @pricetruth/api ops jobs [--limit N]
 *   pnpm --filter @pricetruth/api ops remote      (PRICETRUTH_API_URL [+ INTERNAL_API_TOKEN])
 *
 * `status` prints the same payload as GET /internal/status. `remote` probes a
 * deployed API over HTTP and needs no DATABASE_URL; every other command reads
 * the local database and never writes.
 */
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { getOpsStatus } from "../src/ops.js";
import {
  analyzeListingRow,
  defaultHistoryRepository,
  findListing,
} from "../src/services/analysisService.js";

const USAGE = `usage: pnpm ops <command>
  status
  recent [--limit N]
  listing <retailer> <externalId>
  quarantined [--limit N]
  jobs [--limit N]
  remote   (env: PRICETRUTH_API_URL, INTERNAL_API_TOKEN optional)`;

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}
function limit(fallback = 20): number {
  const n = Number(flag("limit") ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("--limit must be 1..1000");
  return n;
}
const print = (v: unknown) =>
  console.log(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));

async function recent(prisma: PrismaClient) {
  const rows = await prisma.priceObservation.findMany({
    orderBy: { id: "desc" },
    take: limit(),
    include: { listing: { select: { retailerId: true, externalId: true } }, dataSource: true },
  });
  return rows.map((o) => ({
    id: o.id,
    retailer: o.listing.retailerId,
    externalId: o.listing.externalId,
    priceCents: o.priceCents,
    referencePriceCents: o.referencePriceCents,
    currency: o.currency,
    status: o.status,
    synthetic: o.synthetic,
    dataSource: o.dataSource.key,
    effectiveAt: o.effectiveAt,
    receivedAt: o.receivedAt,
  }));
}

async function listing(prisma: PrismaClient, retailer?: string, externalId?: string) {
  if (!retailer || !externalId) throw new Error("usage: ops listing <retailer> <externalId>");
  const row = await findListing(prisma, retailer, externalId);
  if (!row) return { error: "listing_not_found", retailer, externalId };
  const [product, variants, assertions, observations, dailyPrices] = await Promise.all([
    row.productId
      ? prisma.product.findUnique({
          where: { id: row.productId },
          include: { identifiers: true, family: true },
        })
      : null,
    prisma.listingVariant.findMany({ where: { listingId: row.id } }),
    prisma.identifierAssertion.findMany({
      where: { listingId: row.id },
      include: { dataSource: { select: { key: true } } },
    }),
    prisma.priceObservation.findMany({
      where: { listingId: row.id },
      orderBy: { id: "desc" },
      take: 50,
      include: { dataSource: { select: { key: true } } },
    }),
    prisma.listingDailyPrice.findMany({ where: { listingId: row.id }, orderBy: { day: "asc" } }),
  ]);
  const analysis = await analyzeListingRow(defaultHistoryRepository(prisma), row);
  return {
    listing: row,
    product,
    variants,
    identifierAssertions: assertions.map((a) => ({ ...a, dataSource: a.dataSource.key })),
    observations: observations.map((o) => ({ ...o, dataSource: o.dataSource.key })),
    dailyPrices,
    analysis,
  };
}

async function quarantined(prisma: PrismaClient) {
  const rows = await prisma.priceObservation.findMany({
    where: { status: { in: ["QUARANTINED", "EXCLUDED"] } },
    orderBy: { id: "desc" },
    take: limit(),
    include: {
      listing: { select: { retailerId: true, externalId: true } },
      dataSource: { select: { key: true } },
      statusEvents: { orderBy: { id: "desc" }, take: 1 },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    retailer: o.listing.retailerId,
    externalId: o.listing.externalId,
    priceCents: o.priceCents,
    referencePriceCents: o.referencePriceCents,
    status: o.status,
    dataSource: o.dataSource.key,
    effectiveAt: o.effectiveAt,
    latestStatusEvent: o.statusEvents[0]
      ? {
          fromStatus: o.statusEvents[0].fromStatus,
          toStatus: o.statusEvents[0].toStatus,
          reason: o.statusEvents[0].reason,
          actor: o.statusEvents[0].actor,
          createdAt: o.statusEvents[0].createdAt,
        }
      : null,
  }));
}

async function jobs(prisma: PrismaClient) {
  const [runs, checkpoints] = await Promise.all([
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: limit() }),
    prisma.jobCheckpoint.findMany({ orderBy: { jobName: "asc" } }),
  ]);
  return { runs, checkpoints };
}

async function remote(): Promise<number> {
  const base = process.env.PRICETRUTH_API_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("PRICETRUTH_API_URL is required for `ops remote`");
  const token = process.env.INTERNAL_API_TOKEN;

  const probe = async (path: string, headers: Record<string, string> = {}) => {
    try {
      const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON body */
      }
      return { path, status: res.status, body };
    } catch (err) {
      return { path, status: null, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const health = await probe("/health");
  const readiness = await probe("/readiness");
  const internal = token
    ? await probe("/internal/status", { authorization: `Bearer ${token}` })
    : { path: "/internal/status", skipped: "INTERNAL_API_TOKEN not set" };

  print({ apiUrl: base, health, readiness, internalStatus: internal });
  return readiness.status === 200 ? 0 : 1;
}

async function main(): Promise<number> {
  if (cmd === "remote") return remote();
  if (!cmd || !["status", "recent", "listing", "quarantined", "jobs"].includes(cmd)) {
    console.error(USAGE);
    return 1;
  }
  loadConfig(); // validates env; throws on missing vars
  const prisma = createPrismaClient();
  try {
    if (cmd === "status") print(await getOpsStatus(prisma));
    else if (cmd === "recent") print(await recent(prisma));
    else if (cmd === "listing") print(await listing(prisma, argv[1], argv[2]));
    else if (cmd === "quarantined") print(await quarantined(prisma));
    else if (cmd === "jobs") print(await jobs(prisma));
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
