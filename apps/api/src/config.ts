import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  BESTBUY_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Comma-separated list of extra allowed CORS origins (chrome-extension:// is always allowed). */
  CORS_ORIGINS: z.string().optional(),
  /** Root dir for the local observation archive (jobs archive). */
  ARCHIVE_LOCAL_DIR: z.string().default("./archive"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
