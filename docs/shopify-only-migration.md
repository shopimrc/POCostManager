# Shopify-only storage migration (work in progress)

This branch is intentionally NOT deployable yet. Do not merge into main or deploy to Render.

## Current persistence inventory
- `prisma/schema.prisma`: Session, Supplier, PurchaseOrder, PurchaseOrderLine.
- `app/shopify.server.js`: Shopify PrismaSessionStorage, including offline access tokens.
- `app/routes/app.purchase-orders.new.jsx`: supplier creation, PO number generation, PO creation.
- `app/routes/app.purchase-orders.$id.jsx`: supplier creation, editing, draft deletion, partial/full receipt.
- `app/routes/app.purchase-orders._index.jsx`: PO listing.

## Target storage
- App-owned Shopify metaobject definitions for suppliers and purchase orders, with stable handles/IDs.
- PO line snapshots stored in PO records or separate linked metaobjects, subject to Shopify field size limits.
- Explicit receipt ledger with stable idempotency keys; never rely on an HTTP retry to be unique.
- Query all pages for lists and PO number generation, rather than assuming first 100 entries are complete.
- Migration exporter from existing PostgreSQL before any cutover, with counts and checksums.
- Rollback plan: leave the current PostgreSQL-backed production version untouched until validated.

## Authentication blocker (must be solved before replacing Prisma)
Shopify Admin API metaobjects cannot store the offline token used to authenticate the API call itself.
Do NOT write tokens to metaobjects, a public repo, Render free ephemeral filesystem, or browser storage.
Evaluate a secure, persistent, zero-extra-cost token strategy compatible with the actual app distribution.
Do not remove PrismaSessionStorage until this has been verified.

## Receipt correctness blocker
The current `computeReceiptLines` uses `displayQty` for weighted cost instead of the actual
`qtyReceivingNow`, and the receiving handler changes Shopify inventory/cost before persisting
receipt progress. Repeated requests and mid-loop errors can double-receive stock.
A safe migration must:
1. Read current inventory and unit cost from Shopify immediately before the receipt.
2. Validate quantity against the outstanding PO quantity.
3. Allocate charges to the actual received quantities according to an explicit policy.
4. Persist a receipt operation identifier and status before external side effects.
5. Track inventory-adjustment and cost-update results per line, and reconcile retries.
6. Record final receipt quantities only after all relevant effects are confirmed.
7. Test partial receipts, zero-quantity lines, duplicate requests, and mid-operation failures.

## Cutover checklist
- [ ] Choose and validate persistent Shopify authentication strategy.
- [ ] Define and create Shopify custom-data definitions (limits, permissions, pagination).
- [ ] Implement Shopify-backed supplier/PO/receipt repositories.
- [ ] Update all loaders and actions; enforce shop ownership and authorization.
- [ ] Fix receipt calculation and idempotency.
- [ ] Export and verify all existing suppliers, POs, lines and receipts.
- [ ] Run tests against a development Shopify store.
- [ ] Plan a deliberate production cutover and backup.
- [ ] Only then remove Prisma, PostgreSQL, and DATABASE_URL.

This file is an engineering checkpoint, not a completed migration.
