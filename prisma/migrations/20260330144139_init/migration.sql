/*
  Warnings:

  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Session";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "locationGid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "freightTotal" REAL NOT NULL DEFAULT 0,
    "dutyTotal" REAL NOT NULL DEFAULT 0,
    "otherFeesTotal" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "inventoryItemGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currentCost" REAL NOT NULL,
    "currentQty" INTEGER NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "vendorCost" REAL NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
