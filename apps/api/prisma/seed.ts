import { PrismaClient } from "@prisma/client";
import { DATA_SOURCE_DEFINITIONS, RETAILERS } from "@pricetruth/shared";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const retailer of Object.values(RETAILERS)) {
    await prisma.retailer.upsert({
      where: { id: retailer.id },
      update: { displayName: retailer.displayName },
      create: { id: retailer.id, displayName: retailer.displayName },
    });
  }
  for (const ds of DATA_SOURCE_DEFINITIONS) {
    await prisma.dataSource.upsert({
      where: { key: ds.key },
      update: {
        displayName: ds.displayName,
        sourceType: ds.sourceType,
        trustClass: ds.trustClass,
      },
      create: { ...ds },
    });
  }
  console.log(
    `Seeded ${Object.keys(RETAILERS).length} retailers and ${DATA_SOURCE_DEFINITIONS.length} data sources.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
