import type { z } from "zod";
import { retailerObservationSchema } from "@pricetruth/shared";

/**
 * Single source for the OpenAPI spec: the route table lives here (one place)
 * and request schemas reuse the shared zod schemas. `pnpm --filter
 * @pricetruth/api openapi` renders this table to docs/openapi.json; CI
 * regenerates and diffs it.
 */
export interface RouteSpec {
  method: "GET" | "POST";
  path: string;
  summary: string;
  tags: string[];
  /** Path parameter names, in order of appearance. */
  params?: Array<{ name: string; description: string; pattern?: string }>;
  query?: Array<{
    name: string;
    required?: boolean;
    schema: Record<string, unknown>;
    description?: string;
  }>;
  bodySchema?: z.ZodTypeAny;
  /** Success status + short description of the payload shape. */
  success: { status: number; description: string };
  errors: Array<{ status: number; code: string; description: string }>;
  auth?: "bearer" | "none";
}

const ERROR_BODY = "{error, message} (+ retryAfterSeconds on 429)";

export const ROUTES: RouteSpec[] = [
  {
    method: "GET",
    path: "/health",
    summary: "Liveness probe — always 200",
    tags: ["ops"],
    success: {
      status: 200,
      description: "{status, product, db, apiVersion, uptimeSeconds, version}",
    },
    errors: [],
    auth: "none",
  },
  {
    method: "GET",
    path: "/readiness",
    summary: "Readiness probe — 200 when DB up and migrations applied",
    tags: ["ops"],
    success: {
      status: 200,
      description: "{status:'ready', checks:{database, migrations}, apiVersion}",
    },
    errors: [{ status: 503, code: "not_ready", description: "checks.database/migrations not ok" }],
    auth: "none",
  },
  {
    method: "POST",
    path: "/v1/observations",
    summary: "Ingest a retailer observation (idempotent via ±60 min dedupe)",
    tags: ["ingest"],
    bodySchema: retailerObservationSchema,
    success: {
      status: 201,
      description:
        "{accepted, duplicate, status, listingId, observationId, enrichment, apiVersion}; 200 with duplicate:true on dedupe",
    },
    errors: [
      { status: 400, code: "invalid_observation", description: "Schema/field/policy rejection" },
      { status: 400, code: "unsupported_schema_version", description: "schemaVersion != 1" },
      { status: 413, code: "request_error", description: `Body > 64 KB — ${ERROR_BODY}` },
      { status: 429, code: "rate_limited", description: `60/min per IP — ${ERROR_BODY}` },
    ],
    auth: "none",
  },
  {
    method: "GET",
    path: "/v1/listings/{retailer}/{externalId}/analysis",
    summary: "Price analysis: Discount Integrity + Deal Score + evidence",
    tags: ["read"],
    params: [
      { name: "retailer", description: "Retailer id", pattern: "^(amazon|bestbuy)$" },
      { name: "externalId", description: "Retailer listing id (ASIN / SKU)" },
    ],
    success: { status: 200, description: "AnalysisResponse + apiVersion" },
    errors: [
      { status: 404, code: "listing_not_found", description: ERROR_BODY },
      { status: 429, code: "rate_limited", description: `240/min per IP — ${ERROR_BODY}` },
    ],
    auth: "none",
  },
  {
    method: "GET",
    path: "/v1/listings/{retailer}/{externalId}/history",
    summary: "Raw observation points + daily-median series",
    tags: ["read"],
    params: [
      { name: "retailer", description: "Retailer id", pattern: "^(amazon|bestbuy)$" },
      { name: "externalId", description: "Retailer listing id (ASIN / SKU)" },
    ],
    query: [
      {
        name: "days",
        schema: { type: "integer", minimum: 1, maximum: 730, default: 180 },
        description: "Window length in days",
      },
    ],
    success: { status: 200, description: "HistoryResponse + apiVersion" },
    errors: [
      { status: 404, code: "listing_not_found", description: ERROR_BODY },
      { status: 429, code: "rate_limited", description: `240/min per IP — ${ERROR_BODY}` },
    ],
    auth: "none",
  },
  {
    method: "GET",
    path: "/internal/metrics",
    summary: "Process-local metrics (JSON; ?format=prometheus for text)",
    tags: ["internal"],
    query: [{ name: "format", schema: { type: "string", enum: ["prometheus"] } }],
    success: {
      status: 200,
      description: "{counters:[{name,labels,count}], durations:[{operation,count,p50,p95,max}]}",
    },
    errors: [],
    auth: "none",
  },
  {
    method: "GET",
    path: "/internal/status",
    summary: "Ops status payload (observations, job checkpoints, counts)",
    tags: ["internal"],
    success: {
      status: 200,
      description:
        "{latestObservationReceivedAt, observationsLastHour/24h, statusDistribution, rollup, archive, counts, lastJobRuns}",
    },
    errors: [
      { status: 404, code: "not_found", description: "Token unset or wrong (404 hides the route)" },
    ],
    auth: "bearer",
  },
];
