import { PrismaClient } from "@prisma/client";
import { RETAILERS } from "@pricetruth/shared";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const retailer of Object.values(RETAILERS)) {
    await prisma.retailer.upsert({
      where: { id: retailer.id },
      update: { displayName: retailer.displayName },
      create: { id: retailer.id, displayName: retailer.displayName },
    });
  }
  console.log(`Seeded ${Object.keys(RETAILERS).length} retailers.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
