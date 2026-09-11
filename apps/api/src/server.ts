import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrismaClient } from "./db.js";

const config = loadConfig();
const prisma = createPrismaClient();
const app = await buildApp({ prisma, config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
