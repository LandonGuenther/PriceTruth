-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('GTIN', 'UPC', 'EAN', 'MPN', 'ASIN', 'BESTBUY_SKU');

-- CreateTable
CREATE TABLE "Retailer" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Retailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "modelNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductIdentifier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ProductIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "modelNumber" TEXT,
    "gtin" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "referencePriceCents" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "inStock" BOOLEAN,
    "variant" JSONB,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "clientVersion" TEXT,
    "userAgentHash" TEXT,
    "ingestKey" TEXT,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductIdentifier_type_value_key" ON "ProductIdentifier"("type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_retailerId_externalId_key" ON "Listing"("retailerId", "externalId");

-- CreateIndex
CREATE INDEX "PriceObservation_listingId_observedAt_idx" ON "PriceObservation"("listingId", "observedAt");

-- AddForeignKey
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
