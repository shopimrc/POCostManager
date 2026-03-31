-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "inventoryItemGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currentCost" REAL NOT NULL,
    "currentQty" INTEGER NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "vendorCost" REAL NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderLine" ("currentCost", "currentQty", "id", "inventoryItemGid", "purchaseOrderId", "qtyOrdered", "sku", "title", "vendorCost") SELECT "currentCost", "currentQty", "id", "inventoryItemGid", "purchaseOrderId", "qtyOrdered", "sku", "title", "vendorCost" FROM "PurchaseOrderLine";
DROP TABLE "PurchaseOrderLine";
ALTER TABLE "new_PurchaseOrderLine" RENAME TO "PurchaseOrderLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
