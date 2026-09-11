-- M4: deterministic daily rollup table + durable job checkpoint.

CREATE TABLE "ListingDailyPrice" (
    "id" BIGSERIAL PRIMARY KEY,
    "listingId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "eligibleObservationCount" INTEGER NOT NULL,
    "lowCents" INTEGER NOT NULL,
    "highCents" INTEGER NOT NULL,
    "medianCents" INTEGER NOT NULL,
    "firstCents" INTEGER NOT NULL,
    "lastCents" INTEGER NOT NULL,
    "referenceMedianCents" INTEGER,
    "sourceCount" INTEGER NOT NULL,
    "aggregationVersion" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingDailyPrice_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ListingDailyPrice_listingId_day_key" ON "ListingDailyPrice"("listingId", "day");
CREATE INDEX "ListingDailyPrice_listingId_idx" ON "ListingDailyPrice"("listingId");

CREATE TABLE "JobCheckpoint" (
    "jobName" TEXT PRIMARY KEY,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
