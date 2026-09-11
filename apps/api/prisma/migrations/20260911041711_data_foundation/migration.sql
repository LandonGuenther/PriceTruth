-- PriceTruth Phase 2: data foundation.
-- Non-destructive rewrite: dimension ids TEXT → uuid (loud cast, no coercion),
-- PriceObservation rebuilt as a BIGINT-pk fact table with time provenance and
-- DataSource/ListingVariant/ObservationStatusEvent dimensions.

-- Enums ---------------------------------------------------------------------

CREATE TYPE "SourceType" AS ENUM ('EXTENSION_DOM', 'OFFICIAL_RETAILER_API', 'MERCHANT_FEED', 'LICENSED_DATA', 'MANUAL_VERIFICATION', 'SYNTHETIC_TEST');
CREATE TYPE "TrustClass" AS ENUM ('CLIENT_REPORTED', 'SERVER_FETCHED', 'VERIFIED', 'TEST');
CREATE TYPE "RedistributionReviewStatus" AS ENUM ('UNKNOWN', 'INTERNAL_ONLY', 'AGGREGATED_ONLY', 'APPROVED');
CREATE TYPE "PriceType" AS ENUM ('STANDARD', 'SALE', 'MEMBER', 'SUBSCRIPTION', 'COUPON_REQUIRED', 'INSTALLMENT', 'USED', 'REFURBISHED', 'MARKETPLACE', 'UNKNOWN');
CREATE TYPE "ReferencePriceType" AS ENUM ('WAS_PRICE', 'LIST_PRICE', 'MSRP', 'COMP_VALUE', 'REGULAR_PRICE', 'UNKNOWN');
CREATE TYPE "ObservationStatus" AS ENUM ('ACCEPTED', 'QUARANTINED', 'EXCLUDED');

-- DataSource (seeded here — migrations cannot import TS; these rows must match
-- DATA_SOURCE_DEFINITIONS in @pricetruth/shared) ------------------------------

CREATE TABLE "DataSource" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "trustClass" "TrustClass" NOT NULL,
    "redistributionReviewStatus" "RedistributionReviewStatus" NOT NULL DEFAULT 'UNKNOWN',
    "termsReference" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DataSource_key_key" ON "DataSource"("key");

INSERT INTO "DataSource" ("id", "key", "displayName", "sourceType", "trustClass", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'extension:content-script', 'Chrome extension (page DOM)', 'EXTENSION_DOM', 'CLIENT_REPORTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bestbuy:products-api', 'Best Buy Products API', 'OFFICIAL_RETAILER_API', 'SERVER_FETCHED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'manual', 'Manual verification', 'MANUAL_VERIFICATION', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'synthetic:test', 'Synthetic test data', 'SYNTHETIC_TEST', 'TEST', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ListingVariant ------------------------------------------------------------

CREATE TABLE "ListingVariant" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "attributes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingVariant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ListingVariant_listingId_fingerprint_key" ON "ListingVariant"("listingId", "fingerprint");

-- ObservationStatusEvent (FK added after the fact-table rebuild) -------------

CREATE TABLE "ObservationStatusEvent" (
    "id" BIGSERIAL NOT NULL,
    "observationId" BIGINT NOT NULL,
    "fromStatus" "ObservationStatus" NOT NULL,
    "toStatus" "ObservationStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationStatusEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ObservationStatusEvent_observationId_idx" ON "ObservationStatusEvent"("observationId");

-- Dimension id columns TEXT → UUID (loud cast: invalid values abort the txn) --

ALTER TABLE "Listing" DROP CONSTRAINT "Listing_productId_fkey";
ALTER TABLE "PriceObservation" DROP CONSTRAINT "PriceObservation_listingId_fkey";
ALTER TABLE "ProductIdentifier" DROP CONSTRAINT "ProductIdentifier_productId_fkey";
DROP INDEX "PriceObservation_listingId_observedAt_idx";

ALTER TABLE "Product" ALTER COLUMN "id" TYPE uuid USING ("id"::uuid);
ALTER TABLE "ProductIdentifier" ALTER COLUMN "id" TYPE uuid USING ("id"::uuid);
ALTER TABLE "ProductIdentifier" ALTER COLUMN "productId" TYPE uuid USING ("productId"::uuid);
ALTER TABLE "Listing" ALTER COLUMN "id" TYPE uuid USING ("id"::uuid);
ALTER TABLE "Listing" ALTER COLUMN "productId" TYPE uuid USING ("productId"::uuid);
ALTER TABLE "PriceObservation" ALTER COLUMN "listingId" TYPE uuid USING ("listingId"::uuid);

-- Fact table rebuild ---------------------------------------------------------

-- Guard: the old per-row `variant` JSON maps to ListingVariant rows in the app
-- now; the JSON-text fingerprint would differ from the app's canonical-JSON
-- fingerprint. No MVP row ever carried variant data — refuse to guess if some
-- environment does.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PriceObservation"
             WHERE "variant" IS NOT NULL
               AND "variant" <> '{}'::jsonb
               AND "variant" <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'PriceObservation rows with variant JSON exist; handle variants manually before migrating';
  END IF;
END $$;

CREATE TABLE "PriceObservation_new" (
    "id" BIGSERIAL NOT NULL,
    "listingId" UUID NOT NULL,
    "variantId" UUID,
    "dataSourceId" UUID NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "priceType" "PriceType" NOT NULL DEFAULT 'UNKNOWN',
    "referencePriceCents" INTEGER,
    "referenceType" "ReferencePriceType",
    "currency" CHAR(3) NOT NULL,
    "inStock" BOOLEAN,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientObservedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "clientSkewSeconds" INTEGER,
    "status" "ObservationStatus" NOT NULL DEFAULT 'ACCEPTED',
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL,
    "clientVersion" TEXT,
    "extractorVersion" TEXT,

    CONSTRAINT "PriceObservation_new_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PriceObservation_new" (
    "listingId", "variantId", "dataSourceId", "priceCents", "priceType",
    "referencePriceCents", "referenceType", "currency", "inStock",
    "receivedAt", "clientObservedAt", "effectiveAt", "clientSkewSeconds",
    "status", "synthetic", "schemaVersion", "clientVersion", "extractorVersion"
)
SELECT
    o."listingId",
    NULL,
    s."id",
    o."priceCents",
    'STANDARD',
    o."referencePriceCents",
    CASE WHEN o."referencePriceCents" IS NULL THEN NULL ELSE 'UNKNOWN'::"ReferencePriceType" END,
    o."currency",
    o."inStock",
    o."receivedAt",
    o."observedAt",
    CASE WHEN s."trustClass" = 'CLIENT_REPORTED' THEN o."receivedAt" ELSE o."observedAt" END,
    CASE WHEN s."trustClass" = 'CLIENT_REPORTED'
         THEN EXTRACT(EPOCH FROM (o."observedAt" - o."receivedAt"))::int END,
    'ACCEPTED',
    o."synthetic",
    1,
    o."clientVersion",
    NULL
FROM "PriceObservation" o
JOIN "DataSource" s ON s."key" = o."source"
ORDER BY o."observedAt", o."receivedAt";

DO $$
DECLARE
  old_count int;
  new_count int;
BEGIN
  SELECT count(*) INTO old_count FROM "PriceObservation";
  SELECT count(*) INTO new_count FROM "PriceObservation_new";
  IF old_count <> new_count THEN
    RAISE EXCEPTION 'migration dropped observations: old % rows, new % rows', old_count, new_count;
  END IF;
END $$;

DROP TABLE "PriceObservation";
ALTER TABLE "PriceObservation_new" RENAME TO "PriceObservation";
ALTER TABLE "PriceObservation" RENAME CONSTRAINT "PriceObservation_new_pkey" TO "PriceObservation_pkey";
ALTER SEQUENCE "PriceObservation_new_id_seq" RENAME TO "PriceObservation_id_seq";

CREATE INDEX "PriceObservation_listingId_effectiveAt_idx" ON "PriceObservation"("listingId", "effectiveAt");
CREATE INDEX "PriceObservation_dataSourceId_idx" ON "PriceObservation"("dataSourceId");

-- Foreign keys ----------------------------------------------------------------

ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ListingVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ObservationStatusEvent" ADD CONSTRAINT "ObservationStatusEvent_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "PriceObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity constraints (not expressible in Prisma) ---------------------------

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_price_positive" CHECK ("priceCents" > 0),
  ADD CONSTRAINT "PriceObservation_reference_positive" CHECK ("referencePriceCents" IS NULL OR "referencePriceCents" > 0),
  ADD CONSTRAINT "PriceObservation_reference_type_consistent" CHECK (("referencePriceCents" IS NULL) = ("referenceType" IS NULL)),
  ADD CONSTRAINT "PriceObservation_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "PriceObservation_schema_version_positive" CHECK ("schemaVersion" >= 1);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_externalId_nonempty" CHECK (length("externalId") > 0);
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_key_nonempty" CHECK (length("key") > 0);

-- Append-only guard: only `status` may change; deletes are forbidden ----------

CREATE OR REPLACE FUNCTION pricetruth_forbid_observation_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PriceObservation rows are append-only (delete forbidden)'; END IF;
  IF ROW(NEW."listingId", NEW."variantId", NEW."dataSourceId", NEW."priceCents", NEW."priceType", NEW."referencePriceCents", NEW."referenceType", NEW."currency", NEW."inStock", NEW."receivedAt", NEW."clientObservedAt", NEW."effectiveAt", NEW."clientSkewSeconds", NEW."synthetic", NEW."schemaVersion", NEW."clientVersion", NEW."extractorVersion")
     IS DISTINCT FROM
     ROW(OLD."listingId", OLD."variantId", OLD."dataSourceId", OLD."priceCents", OLD."priceType", OLD."referencePriceCents", OLD."referenceType", OLD."currency", OLD."inStock", OLD."receivedAt", OLD."clientObservedAt", OLD."effectiveAt", OLD."clientSkewSeconds", OLD."synthetic", OLD."schemaVersion", OLD."clientVersion", OLD."extractorVersion")
  THEN RAISE EXCEPTION 'PriceObservation rows are append-only (only status may change)'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "PriceObservation_append_only" BEFORE UPDATE OR DELETE ON "PriceObservation"
  FOR EACH ROW EXECUTE FUNCTION pricetruth_forbid_observation_mutation();
