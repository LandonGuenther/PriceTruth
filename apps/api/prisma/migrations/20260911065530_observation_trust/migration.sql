-- M3 trust model: RECEIVED + CORROBORATED statuses, actor on status events.
-- Non-destructive: new enum values and a nullable→NOT NULL column with backfill.

ALTER TYPE "ObservationStatus" ADD VALUE 'RECEIVED';
ALTER TYPE "ObservationStatus" ADD VALUE 'CORROBORATED';

ALTER TABLE "ObservationStatusEvent" ADD COLUMN "actor" VARCHAR(120);
UPDATE "ObservationStatusEvent" SET "actor" = 'system:legacy' WHERE "actor" IS NULL;
ALTER TABLE "ObservationStatusEvent" ALTER COLUMN "actor" SET NOT NULL;
