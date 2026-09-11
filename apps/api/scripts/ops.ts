/**
 * Ops CLI. Usage: pnpm --filter @pricetruth/api ops status
 * Prints the same JSON payload as GET /internal/status.
 */
import { createPrismaClient } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { getOpsStatus } from "../src/ops.js";

const cmd = process.argv[2];
loadConfig(); // validates env; exits via throw on missing vars

if (cmd !== "status") {
  console.error("usage: pnpm ops status");
  process.exit(1);
}

const prisma = createPrismaClient();
try {
  const status = await getOpsStatus(prisma);
  console.log(JSON.stringify(status, null, 2));
} finally {
  await prisma.$disconnect();
}
