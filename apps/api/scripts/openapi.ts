/**
 * Generates docs/openapi.json from the route table in src/routes/contract.ts
 * (request bodies reuse the shared zod schemas via zod-to-json-schema).
 * Usage: pnpm --filter @pricetruth/api openapi
 * CI regenerates the file and `git diff --exit-code`s it.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { API_VERSION } from "../src/apiVersion.js";
import { ROUTES, type RouteSpec } from "../src/routes/contract.js";

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    retryAfterSeconds: { type: "integer" },
  },
  required: ["error"],
};

function operationFor(r: RouteSpec) {
  const op: Record<string, unknown> = {
    summary: r.summary,
    tags: r.tags,
    responses: {
      [r.success.status]: { description: r.success.description },
      ...Object.fromEntries(
        r.errors.map((e) => [
          e.status,
          {
            description: `${e.code}: ${e.description}`,
            content: { "application/json": { schema: ERROR_SCHEMA } },
          },
        ]),
      ),
    },
  };
  if (r.auth === "bearer") op.security = [{ bearerAuth: [] }];
  const params = [
    ...(r.params ?? []).map((p) => ({
      name: p.name,
      in: "path",
      required: true,
      description: p.description,
      schema: { type: "string", ...(p.pattern ? { pattern: p.pattern } : {}) },
    })),
    ...(r.query ?? []).map((q) => ({
      name: q.name,
      in: "query",
      required: q.required ?? false,
      description: q.description,
      schema: q.schema,
    })),
  ];
  if (params.length) op.parameters = params;
  if (r.bodySchema) {
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            ...zodToJsonSchema(r.bodySchema, { target: "openApi3" }),
            $schema: undefined,
          },
        },
      },
    };
  }
  return op;
}

const doc = {
  openapi: "3.0.3",
  info: {
    title: "PriceTruth API",
    version: String(API_VERSION),
    description:
      "Price-evidence API. All responses carry x-pricetruth-api-version and " +
      "x-request-id; /v1 + /internal responses are cache-control: no-store.",
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
  },
  paths: Object.fromEntries(
    ROUTES.map((r) => [r.path, { [r.method.toLowerCase()]: operationFor(r) }]),
  ),
};

const out = resolve(import.meta.dirname, "../../../docs/openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
// Normalise to prettier style so format:check and the CI diff both pass.
execSync(`pnpm exec prettier --write "${out}"`, {
  cwd: resolve(import.meta.dirname, "../../.."),
  stdio: "pipe",
});
console.log(`wrote ${out}`);
