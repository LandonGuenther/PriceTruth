import { z } from "zod";
import type { RetailerId } from "./retailers.js";

export const OBSERVATION_SOURCES = {
  EXTENSION_CONTENT_SCRIPT: "extension:content-script",
  BESTBUY_API: "bestbuy:products-api",
  MANUAL: "manual",
} as const;

export type ObservationSource = (typeof OBSERVATION_SOURCES)[keyof typeof OBSERVATION_SOURCES];

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
  observedAt: string;
}

export const retailerObservationSchema = z.object({
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
});
