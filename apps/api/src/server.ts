import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrismaClient } from "./db.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const prisma = createPrismaClient();
const app = await buildApp({ prisma, config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
