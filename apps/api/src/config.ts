import { z, ZodError } from "zod";

const EXTENSION_ID_RE = /^[a-p]{32}$/;

const boolEnv = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(def ? "true" : "false")
    .transform((v) => v === "true" || v === "1");

/** trustProxy accepts boolean, hop count, or a comma-separated CIDR/IP list. */
const parseTrustProxy = (raw: string | undefined): boolean | number | string[] => {
  const v = raw?.trim();
  if (!v) return false;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    /** Default: 127.0.0.1 in development/test, 0.0.0.0 in staging/production. */
    HOST: z.string().optional(),
    /** Default: info (staging/production), debug (development), silent (test). */
    LOG_LEVEL: z.string().optional(),
    /** true | false | hop count | comma-separated CIDR/IP list. */
    TRUST_PROXY: z.string().optional(),
    BESTBUY_API_KEY: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined)),
    /** Comma-separated list of extra allowed CORS origins. */
    CORS_ORIGINS: z.string().optional(),
    /**
     * Optional comma-separated list of allowed chrome extension ids
     * (each 32 chars in [a-p]). Unset → any chrome-extension:// origin.
     */
    ALLOWED_EXTENSION_IDS: z.string().optional(),
    RATE_LIMIT_INGEST_PER_MINUTE: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_READ_PER_MINUTE: z.coerce.number().int().positive().default(240),
    RATE_LIMIT_HEALTH_PER_MINUTE: z.coerce.number().int().positive().default(600),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(65536),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
    /** When set (≥32 chars), enables /internal/* routes. */
    INTERNAL_API_TOKEN: z
      .string()
      .optional()
      .transform((v) => {
        const t = v?.trim();
        return t ? t : undefined;
      }),
    ARCHIVE_BACKEND: z.enum(["local", "s3"]).default("local"),
    /** Root dir for the local observation archive (jobs archive). */
    ARCHIVE_LOCAL_DIR: z.string().default("./archive"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: boolEnv(false),
    S3_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  })
  .superRefine((env, ctx) => {
    if (env.ALLOWED_EXTENSION_IDS !== undefined) {
      for (const id of env.ALLOWED_EXTENSION_IDS.split(",").map((s) => s.trim())) {
        if (!EXTENSION_ID_RE.test(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ALLOWED_EXTENSION_IDS"],
            message: `entry "${id.slice(0, 8)}…" is not a valid chrome extension id ([a-p]{32})`,
          });
        }
      }
    }
    if (env.INTERNAL_API_TOKEN !== undefined && env.INTERNAL_API_TOKEN.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_API_TOKEN"],
        message: "must be at least 32 characters when set",
      });
    }
    if (env.ARCHIVE_BACKEND === "s3") {
      for (const key of [
        "S3_ENDPOINT",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "is required when ARCHIVE_BACKEND=s3",
          });
        }
      }
    }
    if (env.NODE_ENV === "production") {
      try {
        const host = new URL(env.DATABASE_URL).hostname;
        if (host === "localhost" || host === "127.0.0.1") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["DATABASE_URL"],
            message: "must not point at localhost in production",
          });
        }
      } catch {
        /* url() validation reports it separately */
      }
    }
  })
  .transform((env) => {
    const deployed = env.NODE_ENV === "staging" || env.NODE_ENV === "production";
    const ids = env.ALLOWED_EXTENSION_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      ...env,
      HOST: env.HOST ?? (deployed ? "0.0.0.0" : "127.0.0.1"),
      LOG_LEVEL:
        env.LOG_LEVEL ??
        (env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "development" ? "debug" : "info"),
      TRUST_PROXY: parseTrustProxy(env.TRUST_PROXY),
      ALLOWED_EXTENSION_IDS: ids && ids.length > 0 ? ids : undefined,
    };
  });

export type AppConfig = z.output<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  try {
    return envSchema.parse(env);
  } catch (err) {
    if (err instanceof ZodError) {
      // Names + messages only — never echo env values.
      const lines = err.issues.map((i) => `  ${i.path.join(".") || "(env)"}: ${i.message}`);
      throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
    }
    throw err;
  }
}
