import { buildApp } from "./app.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createPrismaClient } from "./db.js";

let config: AppConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const prisma = createPrismaClient();
const app = await buildApp({ prisma, config });

// Prisma disconnect also runs if close() is invoked elsewhere.
app.addHook("onClose", async () => {
  await prisma.$disconnect();
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutdown requested");
  const hard = setTimeout(() => {
    app.log.error({ signal }, "graceful shutdown timed out; exiting");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  hard.unref();
  try {
    await app.close();
    await prisma.$disconnect();
    clearTimeout(hard);
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
