import { z } from "zod";
import type { RetailerId } from "./retailers.js";

export const OBSERVATION_SOURCES = {
  EXTENSION_CONTENT_SCRIPT: "extension:content-script",
  BESTBUY_API: "bestbuy:products-api",
  MANUAL: "manual",
  SYNTHETIC_TEST: "synthetic:test",
} as const;

export type ObservationSource = (typeof OBSERVATION_SOURCES)[keyof typeof OBSERVATION_SOURCES];

/** Request header carrying the extension/client version on observation ingest. */
export const CLIENT_VERSION_HEADER = "x-pricetruth-client-version";

/** Current wire/schema version for RetailerObservation payloads. */
export const OBSERVATION_SCHEMA_VERSION = 1 as const;

export const PRICE_TYPES = [
  "STANDARD",
  "SALE",
  "MEMBER",
  "SUBSCRIPTION",
  "COUPON_REQUIRED",
  "INSTALLMENT",
  "USED",
  "REFURBISHED",
  "MARKETPLACE",
  "UNKNOWN",
] as const;
export type PriceType = (typeof PRICE_TYPES)[number];
export const priceTypeSchema = z.enum(PRICE_TYPES);

export const REFERENCE_PRICE_TYPES = [
  "WAS_PRICE",
  "LIST_PRICE",
  "MSRP",
  "COMP_VALUE",
  "REGULAR_PRICE",
  "UNKNOWN",
] as const;
export type ReferencePriceType = (typeof REFERENCE_PRICE_TYPES)[number];
export const referencePriceTypeSchema = z.enum(REFERENCE_PRICE_TYPES);

export type SourceType =
  | "EXTENSION_DOM"
  | "OFFICIAL_RETAILER_API"
  | "MERCHANT_FEED"
  | "LICENSED_DATA"
  | "MANUAL_VERIFICATION"
  | "SYNTHETIC_TEST";
export type TrustClass = "CLIENT_REPORTED" | "SERVER_FETCHED" | "VERIFIED" | "TEST";

/**
 * Canonical DataSource rows — the single definition shared by prisma/seed.ts
 * and the API. The data_foundation migration hardcodes the same four rows in
 * SQL (migrations can't import TS).
 */
export const DATA_SOURCE_DEFINITIONS: ReadonlyArray<{
  key: string;
  displayName: string;
  sourceType: SourceType;
  trustClass: TrustClass;
}> = [
  {
    key: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
    displayName: "Chrome extension (page DOM)",
    sourceType: "EXTENSION_DOM",
    trustClass: "CLIENT_REPORTED",
  },
  {
    key: OBSERVATION_SOURCES.BESTBUY_API,
    displayName: "Best Buy Products API",
    sourceType: "OFFICIAL_RETAILER_API",
    trustClass: "SERVER_FETCHED",
  },
  {
    key: OBSERVATION_SOURCES.MANUAL,
    displayName: "Manual verification",
    sourceType: "MANUAL_VERIFICATION",
    trustClass: "VERIFIED",
  },
  {
    key: OBSERVATION_SOURCES.SYNTHETIC_TEST,
    displayName: "Synthetic test data",
    sourceType: "SYNTHETIC_TEST",
    trustClass: "TEST",
  },
];

export interface RetailerObservation {
  retailer: RetailerId;
  externalId: string;
  url: string;
  title: string;
  brand?: string;
  modelNumber?: string;
  gtin?: string;
  priceCents: number;
  referencePriceCents?: number;
  currency: string;
  inStock?: boolean;
  variant?: Record<string, string>;
  source: string;
  /** Client-reported observation time — stored as `clientObservedAt`, untrusted. */
  observedAt: string;
  schemaVersion: number;
  priceType: PriceType;
  /** Required iff `referencePriceCents` is present. */
  referenceType?: ReferencePriceType;
  extractorVersion?: string;
}

export const retailerObservationSchema = z
  .object({
    retailer: z.enum(["amazon", "bestbuy"]),
    externalId: z.string().trim().min(1),
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
        message: "url must be an http(s) URL",
      }),
    title: z.string(),
    brand: z.string().optional(),
    modelNumber: z.string().optional(),
    gtin: z.string().optional(),
    priceCents: z.number().int().positive(),
    referencePriceCents: z.number().int().positive().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter uppercase ISO code"),
    inStock: z.boolean().optional(),
    variant: z.record(z.string()).optional(),
    source: z.string().trim().min(1),
    observedAt: z.string().datetime(),
    schemaVersion: z.literal(OBSERVATION_SCHEMA_VERSION),
    priceType: priceTypeSchema,
    referenceType: referencePriceTypeSchema.optional(),
    extractorVersion: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.referencePriceCents !== undefined && v.referenceType === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceType"],
        message: "referenceType is required when referencePriceCents is present",
      });
    }
    if (v.referenceType !== undefined && v.referencePriceCents === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceType"],
        message: "referenceType must be omitted when referencePriceCents is absent",
      });
    }
  });
