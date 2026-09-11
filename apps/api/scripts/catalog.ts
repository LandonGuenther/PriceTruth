/**
 * Catalog identity CLI.
 *
 *   pnpm --filter @pricetruth/api catalog show <retailer> <externalId>
 *   pnpm --filter @pricetruth/api catalog link <retailer> <externalId> <productId> --reason "..." --actor <name>
 *   pnpm --filter @pricetruth/api catalog unlink <retailer> <externalId> --reason "..." --actor <name>
 */
import { PrismaClient } from "@prisma/client";
import { linkListing, unlinkListing } from "../src/services/catalogService.js";

const prisma = new PrismaClient();

function flag(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

async function main() {
  const [cmd, retailer, externalId, ...rest] = process.argv.slice(2);
  if (!cmd || !retailer || !externalId) {
    throw new Error(
      "usage: catalog <show|link|unlink> <retailer> <externalId> [productId] --reason --actor",
    );
  }
  const listing = await prisma.listing.findUnique({
    where: { retailerId_externalId: { retailerId: retailer, externalId } },
    include: { product: { include: { identifiers: true } } },
  });
  if (!listing) throw new Error(`listing not found: ${retailer}/${externalId}`);

  if (cmd === "show") {
    const [assertions, evidence, links] = await Promise.all([
      prisma.identifierAssertion.findMany({
        where: { listingId: listing.id },
        orderBy: { id: "asc" },
      }),
      prisma.matchEvidence.findMany({
        where: { listingId: listing.id },
        orderBy: { evaluatedAt: "asc" },
      }),
      prisma.productLinkEvent.findMany({
        where: { listingId: listing.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    console.log(JSON.stringify({ listing, assertions, evidence, links }, null, 2));
    return;
  }

  const reason = flag("reason");
  const actor = `cli:${flag("actor")}`;
  if (cmd === "link") {
    const productId = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined;
    if (!productId) throw new Error("link requires <productId>");
    await linkListing(prisma, { listingId: listing.id, productId, reason, actor });
    console.log(`linked ${retailer}/${externalId} -> ${productId}`);
    return;
  }
  if (cmd === "unlink") {
    await unlinkListing(prisma, { listingId: listing.id, reason, actor });
    console.log(`unlinked ${retailer}/${externalId} (fresh 1:1 product created)`);
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
