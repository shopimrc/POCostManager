-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "qtyReceivedTotal" INTEGER NOT NULL DEFAULT 0,
    "itemCost" REAL NOT NULL DEFAULT 0,
    "taxPercent" REAL NOT NULL DEFAULT 0,
    "allocatedLandedCost" REAL NOT NULL DEFAULT 0,
    "landedUnitCost" REAL NOT NULL DEFAULT 0,
    "projectedWeightedCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderLine" ("allocatedLandedCost", "createdAt", "currentCost", "currentInventory", "id", "imageUrl", "inventoryItemGid", "itemCost", "landedUnitCost", "productTitle", "projectedWeightedCost", "purchaseOrderId", "qtyOrdered", "qtyReceiving", "sku", "supplierSku", "taxPercent", "updatedAt", "variantId") SELECT "allocatedLandedCost", "createdAt", "currentCost", "currentInventory", "id", "imageUrl", "inventoryItemGid", "itemCost", "landedUnitCost", "productTitle", "projectedWeightedCost", "purchaseOrderId", "qtyOrdered", "qtyReceiving", "sku", "supplierSku", "taxPercent", "updatedAt", "variantId" FROM "PurchaseOrderLine";
DROP TABLE "PurchaseOrderLine";
ALTER TABLE "new_PurchaseOrderLine" RENAME TO "PurchaseOrderLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
