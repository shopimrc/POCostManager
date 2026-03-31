-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "country" TEXT DEFAULT 'United States',
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "supplierId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrder" ("createdAt", "currency", "destinationAddr", "destinationName", "dutyTotal", "estimatedArrival", "id", "locationGid", "noteToSupplier", "otherFeesTotal", "paymentTerms", "poNumber", "referenceNumber", "shippingCarrier", "shippingTotal", "status", "tags", "taxTotal", "trackingNumber", "updatedAt", "vendorAddress", "vendorName") SELECT "createdAt", "currency", "destinationAddr", "destinationName", "dutyTotal", "estimatedArrival", "id", "locationGid", "noteToSupplier", "otherFeesTotal", "paymentTerms", "poNumber", "referenceNumber", "shippingCarrier", "shippingTotal", "status", "tags", "taxTotal", "trackingNumber", "updatedAt", "vendorAddress", "vendorName" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
