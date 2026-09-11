-- PriceTruth M2: catalog identity.
-- Adds ProductFamily, IdentifierAssertion, MatchEvidence, ProductLinkEvent;
-- IdentifierType gains MANUFACTURER_MODEL. Backfills IdentifierAssertion rows
-- for existing Listings and normalizes existing ProductIdentifier values.
-- Non-destructive; single transaction.

-- Enums ----------------------------------------------------------------------
ALTER TYPE "IdentifierType" ADD VALUE 'MANUFACTURER_MODEL';
CREATE TYPE "AssertionStatus" AS ENUM ('ACTIVE', 'RETRACTED');
CREATE TYPE "MatchLevel" AS ENUM ('EXACT', 'HIGH', 'REVIEW', 'UNRESOLVED', 'CONFLICT');
CREATE TYPE "ProductLinkAction" AS ENUM ('LINK', 'UNLINK');

-- New tables ------------------------------------------------------------------
CREATE TABLE "ProductFamily" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN "familyId" UUID;
ALTER TABLE "Product" ADD CONSTRAINT "Product_familyId_fkey"
    FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IdentifierAssertion" (
    "id" BIGSERIAL NOT NULL,
    "listingId" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "rawValue" VARCHAR(200) NOT NULL,
    "normalizedValue" VARCHAR(200) NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "status" "AssertionStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentifierAssertion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IdentifierAssertion_listingId_fkey"
        FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IdentifierAssertion_dataSourceId_fkey"
        FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IdentifierAssertion_listingId_type_normalizedValue_key"
    ON "IdentifierAssertion"("listingId", "type", "normalizedValue");
CREATE INDEX "IdentifierAssertion_type_normalizedValue_idx"
    ON "IdentifierAssertion"("type", "normalizedValue");

CREATE TABLE "MatchEvidence" (
    "id" BIGSERIAL NOT NULL,
    "listingId" UUID NOT NULL,
    "candidateProductId" UUID,
    "level" "MatchLevel" NOT NULL,
    "reasons" TEXT[] NOT NULL,
    "engineVersion" VARCHAR(32) NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MatchEvidence_listingId_fkey"
        FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MatchEvidence_listingId_evaluatedAt_idx"
    ON "MatchEvidence"("listingId", "evaluatedAt");

CREATE TABLE "ProductLinkEvent" (
    "id" BIGSERIAL NOT NULL,
    "listingId" UUID NOT NULL,
    "action" "ProductLinkAction" NOT NULL,
    "previousProductId" UUID,
    "newProductId" UUID,
    "reason" TEXT NOT NULL,
    "actor" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductLinkEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductLinkEvent_listingId_fkey"
        FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductLinkEvent_listingId_createdAt_idx"
    ON "ProductLinkEvent"("listingId", "createdAt");

-- Normalization helpers (dropped at the end) ----------------------------------
-- GS1 mod-10: digit at 1-indexed position p (check at n) has weight 3 when
-- (n - p) is odd, else 1.
CREATE OR REPLACE FUNCTION pt_mig_gtin_check(d text) RETURNS boolean AS $$
DECLARE
  n int := length(d);
  i int;
  sum int := 0;
  w int;
BEGIN
  IF n NOT IN (8, 12, 13, 14) OR d !~ '^\d+$' THEN RETURN false; END IF;
  FOR i IN 1..n - 1 LOOP
    w := CASE WHEN (n - i) % 2 = 1 THEN 3 ELSE 1 END;
    sum := sum + substr(d, i, 1)::int * w;
  END LOOP;
  RETURN ((10 - (sum % 10)) % 10) = substr(d, n, 1)::int;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- digits-only GTIN normalized to 14 chars when check digit passes, else NULL
CREATE OR REPLACE FUNCTION pt_mig_gtin_norm(raw text) RETURNS text AS $$
DECLARE
  d text := regexp_replace(raw, '\D', '', 'g');
BEGIN
  IF pt_mig_gtin_check(d) THEN RETURN lpad(d, 14, '0'); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Backfill: IdentifierAssertion for existing Listings -------------------------
-- dataSource = extension:content-script (the only source MVP observations came from).
DO $$
DECLARE
  ext_source uuid := (SELECT "id" FROM "DataSource" WHERE "key" = 'extension:content-script');
BEGIN
  IF ext_source IS NULL THEN
    RAISE EXCEPTION 'DataSource extension:content-script missing; apply data_foundation first';
  END IF;

  -- retailer-scoped external id (ASIN / BESTBUY_SKU)
  INSERT INTO "IdentifierAssertion"
    ("listingId", "type", "rawValue", "normalizedValue", "valid", "dataSourceId")
  SELECT l."id",
         CASE l."retailerId" WHEN 'amazon' THEN 'ASIN'::"IdentifierType"
                             WHEN 'bestbuy' THEN 'BESTBUY_SKU'::"IdentifierType"
                             ELSE 'MPN'::"IdentifierType" END,
         l."externalId",
         upper(btrim(l."externalId")),
         CASE l."retailerId"
           WHEN 'amazon' THEN upper(btrim(l."externalId")) ~ '^[A-Z0-9]{10}$'
           WHEN 'bestbuy' THEN btrim(l."externalId") ~ '^\d{1,12}$'
           ELSE length(btrim(l."externalId")) BETWEEN 2 AND 100 END,
         ext_source
  FROM "Listing" l;

  -- GTIN assertions (normalized = 14-digit when valid, else stripped digits)
  INSERT INTO "IdentifierAssertion"
    ("listingId", "type", "rawValue", "normalizedValue", "valid", "dataSourceId")
  SELECT l."id", 'GTIN', l."gtin",
         COALESCE(pt_mig_gtin_norm(l."gtin"), regexp_replace(l."gtin", '\D', '', 'g')),
         pt_mig_gtin_norm(l."gtin") IS NOT NULL,
         ext_source
  FROM "Listing" l WHERE l."gtin" IS NOT NULL;

  -- MANUFACTURER_MODEL assertions are backfilled in the FOLLOWING migration
  -- (newly-added enum values cannot be used in the same transaction).
END $$;

-- Normalize existing ProductIdentifier values (GTIN-family → 14-digit, --------
-- ASIN → uppercase). GTIN-family rows whose check digit fails are left
-- unchanged; a DO guard aborts if normalization would collide on [type, value].
CREATE TEMP TABLE pt_mig_pi_norm AS
SELECT "id",
       CASE WHEN "type" IN ('GTIN', 'UPC', 'EAN')
            THEN COALESCE(pt_mig_gtin_norm("value"), "value")
            WHEN "type" = 'ASIN' THEN upper(btrim("value"))
            ELSE "value" END AS "newValue"
FROM "ProductIdentifier";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT p."type", n."newValue" AS v, count(*) AS c
      FROM pt_mig_pi_norm n JOIN "ProductIdentifier" p ON p."id" = n."id"
      GROUP BY p."type", n."newValue"
      HAVING count(*) > 1
    ) d
  ) THEN
    RAISE EXCEPTION 'ProductIdentifier normalization would create duplicate (type, value) rows';
  END IF;
END $$;

UPDATE "ProductIdentifier" p
SET "value" = n."newValue"
FROM pt_mig_pi_norm n
WHERE p."id" = n."id" AND p."value" IS DISTINCT FROM n."newValue";

DROP TABLE pt_mig_pi_norm;
DROP FUNCTION pt_mig_gtin_check(text);
DROP FUNCTION pt_mig_gtin_norm(text);
