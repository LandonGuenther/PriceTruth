import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

// Source layout (tsx): src/readiness.ts → ../prisma. Built layout: dist/src/
// readiness.js → ../../prisma. Probe candidates and use the first that exists.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = ["../prisma/migrations", "../../prisma/migrations"]
  .map((rel) => path.resolve(HERE, rel))
  .find((p) => existsSync(p));

export type DatabaseCheck = "ok" | "error";
export type MigrationsCheck = "ok" | "pending" | "unknown";

/** Latest expected migration name = lexicographically last directory under prisma/migrations. */
export function expectedLatestMigration(
  migrationsDir: string | undefined = MIGRATIONS_DIR,
): string | null {
  if (!migrationsDir) return null;
  try {
    const names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return names.at(-1) ?? null;
  } catch {
    return null;
  }
}

/** SELECT 1 raced against a timeout. */
export async function databaseCheck(
  prisma: PrismaClient,
  timeoutMs = 2000,
): Promise<DatabaseCheck> {
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return "ok";
  } catch {
    return "error";
  }
}

export async function migrationsCheck(
  prisma: Pick<PrismaClient, "$queryRawUnsafe">,
  expected: string | null,
): Promise<MigrationsCheck> {
  if (!expected) return "unknown";
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL LIMIT 1',
      expected,
    );
    return rows.length > 0 ? "ok" : "pending";
  } catch {
    return "unknown";
  }
}
