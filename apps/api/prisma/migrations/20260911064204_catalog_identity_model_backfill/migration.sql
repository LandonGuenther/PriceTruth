-- Part 2 of catalog identity: MANUFACTURER_MODEL assertions for existing
-- Listings. Must be a separate migration — a new enum value (added in
-- 20260911064203_catalog_identity) cannot be used in the same transaction.

CREATE OR REPLACE FUNCTION pt_mig_model_norm(raw text) RETURNS text AS $$
  SELECT upper(regexp_replace(btrim(raw), '\s+', ' ', 'g'));
$$ LANGUAGE sql IMMUTABLE;

DO $$
DECLARE
  ext_source uuid := (SELECT "id" FROM "DataSource" WHERE "key" = 'extension:content-script');
BEGIN
  IF ext_source IS NULL THEN
    RAISE EXCEPTION 'DataSource extension:content-script missing; apply data_foundation first';
  END IF;

  INSERT INTO "IdentifierAssertion"
    ("listingId", "type", "rawValue", "normalizedValue", "valid", "dataSourceId")
  SELECT l."id", 'MANUFACTURER_MODEL', l."modelNumber",
         pt_mig_model_norm(l."modelNumber"),
         length(pt_mig_model_norm(l."modelNumber")) BETWEEN 2 AND 100,
         ext_source
  FROM "Listing" l WHERE l."modelNumber" IS NOT NULL;
END $$;

DROP FUNCTION pt_mig_model_norm(text);
