-- M5: exported-batch ledger for the observation archive.

CREATE TABLE "ArchiveBatch" (
    "id" BIGSERIAL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "firstObservationId" BIGINT NOT NULL,
    "lastObservationId" BIGINT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ArchiveBatch_key_key" ON "ArchiveBatch"("key");
