/*
  Warnings:

  - You are about to drop the column `freightTotal` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `currentQty` on the `PurchaseOrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `PurchaseOrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `vendorCost` on the `PurchaseOrderLine` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `PurchaseOrder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productTitle` to the `PurchaseOrderLine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `PurchaseOrderLine` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "vendorAddress" TEXT,
    "locationGid" TEXT NOT NULL,
    "destinationName" TEXT,
    "destinationAddr" TEXT,
    "paymentTerms" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "estimatedArrival" TEXT,
    "shippingCarrier" TEXT,
    "trackingNumber" TEXT,
    "referenceNumber" TEXT,
    "noteToSupplier" TEXT,
    "tags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shippingTotal" REAL NOT NULL DEFAULT 0,
    "dutyTotal" REAL NOT NULL DEFAULT 0,
    "otherFeesTotal" REAL NOT NULL DEFAULT 0,
    "taxTotal" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PurchaseOrder" ("createdAt", "dutyTotal", "id", "locationGid", "otherFeesTotal", "poNumber", "status", "vendorName") SELECT "createdAt", "dutyTotal", "id", "locationGid", "otherFeesTotal", "poNumber", "status", "vendorName" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE TABLE "new_PurchaseOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "supplierSku" TEXT,
    "inventoryItemGid" TEXT,
    "variantId" TEXT,
    "imageUrl" TEXT,
    "currentInventory" INTEGER NOT NULL DEFAULT 0,
    "currentCost" REAL NOT NULL DEFAULT 0,
    "qtyOrdered" INTEGER NOT NULL DEFAULT 0,
    "qtyReceiving" INTEGER NOT NULL DEFAULT 0,
    "itemCost" REAL NOT NULL DEFAULT 0,
    "taxPercent" REAL NOT NULL DEFAULT 0,
    "allocatedLandedCost" REAL NOT NULL DEFAULT 0,
    "landedUnitCost" REAL NOT NULL DEFAULT 0,
    "projectedWeightedCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderLine" ("currentCost", "id", "inventoryItemGid", "purchaseOrderId", "qtyOrdered", "sku") SELECT "currentCost", "id", "inventoryItemGid", "purchaseOrderId", "qtyOrdered", "sku" FROM "PurchaseOrderLine";
DROP TABLE "PurchaseOrderLine";
ALTER TABLE "new_PurchaseOrderLine" RENAME TO "PurchaseOrderLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
