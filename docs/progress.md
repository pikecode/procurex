# ProcureX Development Progress

Last updated: 2026-09-25

## Current Position

The backend is currently in M4 settlement/read-model development.

Latest completed milestone: P02 adjustment sources in statements, with failure and funding guards tightened.

Latest committed implementation:

```text
b30d662 Guard price processing and funding checks
1c23421 Refresh M4 progress after price statement work
6c7fbb8 Test statement price adjustment links
3a6a1e3 Link price adjustments from statements
b976b3f Expose price adjustment sources
```

The last committed implementation is recorded in git; the current change is pending verification and commit.

Recommended next step: continue M4 from `docs/development-plan.md`; review P03/reporting and notification scope before moving to M5.

## Verification Baseline

The latest completed stage passed:

```bash
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration && npm run contract:check
```

Current integration coverage count: 26 integration tests passing before the current change.

Current change: price-change runs now report FAILED when any child order fails; payment preview blocks orders whose purchase request has an unresolved positive funding shortfall; purchase confirmation recalculates funding from current item amounts and current account balance before splitting. No balance or ledger mutation is added to price adjustments.

## Completed Areas

### Foundation

- NestJS API entry, health checks, global traceId, response envelope, exception format.
- Prisma schema and migrations for core business tables.
- Command idempotency service and command records.
- Runtime request validation for UUID, expectedVersion, Idempotency-Key, and decimals.

### Identity And Admin

- Password hashing, sessions, login/logout/me APIs.
- Bearer auth guard, current auth decorator, role guard.
- User admin list and status update.
- Store admin list/create/update.
- Supplier admin list/create/update.

### Master Data

- Categories, units, products create/list/archive basics.
- Supplier-product binding.
- Price scopes, price versions, effective price lookup.
- Price publish and price version HTTP endpoints.
- Order templates create/list, store binding, item replacement, supplier settlement override.
- Store catalog endpoint.

### Purchase Flow

Implemented interfaces:

- O01 `POST /purchase-requests/preview`
- O02 `POST /purchase-requests`
- O03 `GET /purchase-requests`, `GET /purchase-requests/{id}`
- O04 `PATCH /purchase-requests/{id}/items`
- O05 `POST /purchase-requests/{id}/reassign-preview`
- O06 `POST /purchase-requests/{id}/assign`
- O07 `POST /purchase-requests/{id}/confirm`
- O08 `POST /purchase-requests/{id}/reject`
- O09 `POST /supplier-orders/{id}/reject`
- O10 `POST /purchase-requests/{id}/reallocate`
- O11 `POST /supplier-orders/{id}/reconcile-funding`

Current O11 behavior:

- Re-evaluates the supplier order's purchase request against the store account balance.
- Refreshes paid and shortfall amounts on the purchase request.
- Marks the purchase request PAID and CONFIRMED when the refreshed stored-value funding is sufficient.
- Uses Idempotency-Key through command records.

### Supplier Orders And Fulfillment

Implemented interfaces:

- F01 `GET /supplier-orders`, `GET /supplier-orders/{id}`
- F02 `POST /supplier-orders/{id}/shipment-preview`
- F03 `POST /supplier-orders/{id}/shipments`

Current F03 behavior:

- Creates `Shipment` and `ShipmentItem` records.
- Supports item-level `gapAllocations` for replenishment gaps.
- Creates `ShipmentGapAllocation` records and decrements gap remaining quantity.
- Marks replenishment gaps PARTIAL_FILLED or FILLED when allocated.
- Supports `freightConfirmationId` for non-zero freight, validates confirmed amount and supplier order ownership, and marks the confirmation USED on shipment creation.
- Updates `OrderItem.shippedQuantity`.
- Updates supplier order status and fulfillment status to `PARTIAL_SHIPPED` or `SHIPPED`.
- Uses Idempotency-Key through command records.

Current F04 behavior:

- Creates `Receipt` and `ReceiptItem` records.
- Supports first receipt revision with `expectedReceiptRevision = 0`.
- Supports replacing the current receipt by submitting the current `expectedReceiptRevision`; the old receipt is retained and marked non-current.
- Supersedes OPEN discrepancies from the replaced receipt; receipts with already resolved/replenishment discrepancies cannot be replaced in this version.
- Validates each shipment item belongs to the shipment.
- Requires receipt items to cover all shipment items exactly once.
- Validates received quantity is between zero and shipped quantity.
- Updates `OrderItem.receivedQuantity`.
- Updates supplier order fulfillment status based on received quantity, permanently reduced quantity, accepted discrepancies, and replenishment gaps.
- Marks supplier orders COMPLETED once all effective quantities are satisfied and no blocking discrepancies or gaps remain.
- Uses Idempotency-Key through command records.

Current F05 behavior:

- Creates an OPEN discrepancy automatically when a receipt item is short.
- Implements `POST /discrepancies/{id}/resolve`.
- Supports ACCEPT, REPLENISH, and RETURN resolution in this version.
- ACCEPT persists a discrepancy action record and marks the discrepancy RESOLVED.
- REPLENISH persists a discrepancy action record, marks the discrepancy REPLENISH_PENDING, and creates a replenishment gap with pending quantity.
- RETURN persists a discrepancy action record, creates a return record for the shortage quantity, and marks the discrepancy RESOLVED.
- Resolving discrepancies recalculates supplier order fulfillment status.
- Uses Idempotency-Key through command records.

Current F06/F07 behavior:

- Implements `POST /supplier-orders/{id}/freight-confirmations`.
- Implements `POST /freight-confirmations/{id}/confirm`.
- Implements `POST /freight-confirmations/{id}/reject`.
- Tracks PENDING, CONFIRMED, REJECTED, and USED statuses.
- Confirmed freight can be attached to a shipment once and is marked USED.
- Uses Idempotency-Key through command records.

## Known Boundaries

- Current access control is role-based. Supplier-user and store-user data-scope binding is not implemented yet.
- Funding logic is still a first pass. It records stored-value summaries and O11 reconciliation results but does not yet implement the complete immutable allocation/ledger behavior described in the long-term design.
- F03 stores permanently reduced quantity on shipment items. Replenishment gap allocation is supported when the caller provides explicit `gapAllocations`.
- F05 RETURN currently records internal shortage-return resolution. Downstream supplier statement/payment disposal remains future work.
- Settlement and reconciliation remain future work.
- Frontend pages are not implemented yet.

### Store Finance

Implemented interfaces:

- A01 `GET /stores/{id}/account`, `GET /stores/{id}/ledgers`
- A02 `POST /stores/{id}/recharges`
- A03 `PATCH /stores/{id}/credit-limit`
- A04 `POST /stores/{id}/clearings/preview`
- A05 `POST /stores/{id}/clearings`
- A06 `GET /recharges/{id}`, `GET /clearings/{id}`

Current A01 behavior:

- Returns store account balance, credit limit, credit used, and available credit.
- Returns account ledgers ordered by occurred time.
- Supports `occurredFrom` and `occurredTo` filters.
- Access control is role-based; store-user data-scope binding is not implemented yet.

Current A02 behavior:

- Creates a `RechargeDocument`.
- Creates the store account when missing, or increments the existing balance.
- Writes a CREDIT account ledger with source type RECHARGE.
- Uses Idempotency-Key through command records.

Current A03 behavior:

- Updates store account credit limit with account-level version checking.
- Rejects limits below currently used credit.
- Uses Idempotency-Key through command records.

Current A06 recharge behavior:

- Returns recharge document details by id.
- Includes the current store account snapshot.
- Access control is role-based; store-user data-scope binding is not implemented yet.

Current A06 clearing behavior:

- Returns clearing document details by id.
- Includes clearing items and the current store account snapshot.
- Access control is role-based; store-user data-scope binding is not implemented yet.

Current A04 behavior:

- Adds the `FundingAllocation` model.
- Validates selected allocations belong to the store, are active, and have clearable credit outstanding.
- Returns per-allocation clearable amounts and total clearable amount.

Current A05 behavior:

- Creates `ClearingDocument` and `ClearingItem` records.
- Requires each selected funding allocation version and amount to match the previewed clearable amount.
- Reduces funding allocation credit outstanding and releases store account credit used.
- Writes a DEBIT account ledger with source type CLEARING.
- Uses Idempotency-Key through command records.

### Settlement Read Models

Implemented interfaces:

- B01 `GET /store-statements`, `GET /store-statements/{id}`
- B02 `GET /supplier-statements`, `GET /supplier-statements/{id}`
- B03 `GET /supplier-store-statements`, `GET /supplier-store-statements/{id}`
- B05 `GET /adjustments`, `GET /adjustments/{id}`
- B06 `POST /payment-records/preview`
- B07 `POST /payment-records`
- B08 `POST /payment-records/{id}/confirm`
- B09 `POST /payment-records/{id}/reject`
- B10 `POST /payment-records/{id}/cancel`
- B11 `GET /payment-records`, `GET /payment-records/{id}`
- B12 `POST /difference-disposals`, `POST /difference-disposals/{id}/confirm`, `GET /difference-disposals/{id}`

Current B01 behavior:

- Dynamically groups completed supplier orders into store-side statements by store, supplier, settlement cycle, and first shipment period.
- Uses the store sales amount plus shipment freight as the store statement total.
- Returns open statement summaries with goods amount, freight amount, total amount, payable amount, and line count.
- Returns statement details with source supplier order lines and source revision.
- Keeps payment and settlement status as an OPEN read model in this first version; allocation and confirmed payment are future work.

Current B02 behavior:

- Dynamically groups completed supplier orders into supplier total statements by supplier, settlement cycle, and first shipment period.
- Uses the supplier supply amount plus shipment freight as the supplier payable total.
- Returns open supplier statement summaries with goods amount, freight amount, total amount, payable amount, store count, and line count.
- Returns supplier statement details with source supplier order lines, store IDs, and source revision.
- Keeps payment and settlement status as an OPEN read model in this first version; shared payment allocation is future work.

Current B03 behavior:

- Dynamically groups completed supplier orders into supplier-store statements by store, supplier, settlement cycle, and first shipment period.
- Uses the supplier supply amount plus shipment freight as the supplier-store payable total.
- Returns `parentStatementId` pointing to the matching supplier total statement for the same supplier and period.
- Returns supplier-store statement details with source supplier order lines and source revision.
- Keeps payment and settlement status as an OPEN read model in this first version; shared settlement item IDs are future work.

Current B05 behavior:

- Dynamically exposes F05 RETURN `DiscrepancyReturn` records as supplier payable decrease adjustments.
- Calculates adjustment amount from returned quantity times source supplier order item supply unit price.
- Returns original supplier statement ID and original period based on the source order first shipped time.
- Returns actual adjustment period based on the return record creation time.
- Supports filtering by storeId, supplierId, cycle, actual period, and processingStatus.
- Marks adjustments DISPOSED when linked to a confirmed `DifferenceDisposal`, otherwise PENDING_DISPOSAL.
- Store receivable adjustments, direct settlement adjustments, price-change adjustments, and persisted adjustment documents remain future work.

Current B06 behavior:

- Statement detail lines expose stable virtual `settlementItemId` values.
- Store statement lines preview as `STORE_TO_COMPANY` payment items using sales amount plus shipment freight.
- Supplier total and supplier-store statement lines share supplier payable IDs and preview as `COMPANY_TO_SUPPLIER` items using supply amount plus shipment freight.
- Validates selected items are completed, share the same payment direction, and belong to the same paying/receiving subject.
- Returns payable amount, pending amount, confirmed paid amount, source version, and blocked items.
- Includes existing RESERVED allocations as pending amounts.

Current B07 behavior:

- Adds `PaymentRecord` and `PaymentAllocation` models.
- Creates a PENDING payment record from previewed settlement item IDs.
- Validates selected items share direction and subject, source versions match, and expected amounts match current payable amounts.
- Creates RESERVED payment allocations so later previews show pending payment amounts and no remaining payable amount for the same items.
- Uses Idempotency-Key through command records.

Current B08 behavior:

- Confirms PENDING payment records with expectedVersion checking.
- Marks the payment record CONFIRMED and increments its version.
- Converts RESERVED allocations to CONFIRMED.
- Later payment previews show confirmed paid amounts and no remaining payable amount for confirmed items.
- Uses Idempotency-Key through command records.

Current B09 behavior:

- Rejects PENDING payment records with expectedVersion checking and a rejection reason.
- Marks the payment record REJECTED and increments its version.
- Converts RESERVED allocations to RELEASED.
- Later payment previews ignore RELEASED allocations, so rejected items become payable again.
- Uses Idempotency-Key through command records.

Current B10 behavior:

- Cancels PENDING payment records with expectedVersion checking and a cancellation reason.
- Marks the payment record CANCELLED and increments its version.
- Converts RESERVED allocations to RELEASED.
- Later payment previews ignore RELEASED allocations, so cancelled items become payable again.
- Uses Idempotency-Key through command records.

Current B11 behavior:

- Lists payment records ordered by creation time.
- Supports filtering by direction, status, storeId, and supplierId.
- Returns payment record details with allocation rows and allocation states.
- Keeps role-based access only in this version; participant data-scope filtering remains future work.

Current B12 behavior:

- Adds `DifferenceDisposal` and `DifferenceDisposalItem` models.
- Creates supplier-to-company offline-return difference disposals from F05 RETURN `DiscrepancyReturn` credit items.
- Creates supplier-to-company OFFSET difference disposals from F05 RETURN credit items to supplier payable settlement items.
- Calculates disposal amount from returned quantity times the source supplier order item supply unit price.
- Requires selected credit items to share the same store and supplier, and rejects already disposed credit items.
- Requires OFFSET target debit items to be completed supplier payable items for the same supplier with enough remaining payable amount.
- Confirms PENDING disposals with expectedVersion checking and records confirmedAt.
- Payment previews subtract confirmed OFFSET disposal amounts from target supplier payable items.
- Uses Idempotency-Key through command records for create and confirm.
- Overpayment, adjustment-driven credit items, direct settlement offsets, and evidence files remain future work.

Current B04 behavior:

- Implements `GET /direct-statements` and `GET /direct-statements/{id}`.
- Groups completed supplier orders for suppliers currently configured with `SUPPLIER_TERM` by store, supplier, cycle, and first shipment period.
- Uses sales goods amount plus shipment freight as the direct settlement total.
- Returns source order lines, stable direct settlement item IDs, source revision, and OPEN payment summary fields.
- Supplier order settlement mode and cycle are snapshotted at order creation; B04 filters and groups on these values, so later supplier configuration changes do not move historical orders.

Current settlement snapshot behavior:

- Adds `settlementMode` and `settlementCycleSnapshot` to supplier orders, with legacy rows defaulted to `COMPANY_TERM` and `MONTHLY`.
- Purchase confirmation and newly created reallocation orders snapshot the template override when present, otherwise the supplier defaults.
- Existing target orders retain their original snapshot when more items are reallocated into them.

Current price history behavior:

- Price versions persist the reason for each change and return it from publish and version history queries.
- Price versions persist a per-scope monotonic revision; the highest revision wins when effective times match, and publishing appends history in a transaction.
- P02 now creates a persisted pending price change run linked to the published version; each currently affected execution order is recorded as a pending run item, and `GET /jobs/{id}` exposes the status and deltas.
- `POST /jobs/{id}/process` applies pending order price changes in one transaction, records before/after prices and amount deltas, updates order/request totals, and marks the run successful.
- The database integration test covers a real affected execution order, updated line totals, and persisted price adjustment source; repeated run processing returns 409.
- `GET /jobs/{id}` returns each processed order's adjustment ID and before/after sales and supply prices.
- `GET /jobs/{id}/adjustments` returns the persisted per-order adjustment source rows for later statement and payment reconciliation.
- Store, supplier total, supplier store, and direct statement detail lines include associated processed price adjustment IDs and deltas; statement amounts use current order totals once.
- P01 previews the uncompleted orders in the price version's effective interval and returns estimated sales and supply deltas; completed orders are excluded.
- Publishing remains synchronous; a separate worker queue and automatic asynchronous run pickup remain future work.

## Recommended Next Step

Continue historical price revaluation and adjustment modeling.

Suggested first version:

- Confirm order/request funding, ledger, and payment-preview paths consume updated totals after an eligible pre-completion price revaluation.
- Add immutable statement snapshots and post-settlement adjustment balances when a supported historical price-change flow can reach settled orders.
- Add P01 impact preview and asynchronous P02 revaluation with persisted per-order outcomes and adjustments.
- Add overpayment disposal flows after payment confirmation can record real overpaid amounts.
- Connect adjustment sources to payment remaining balances and preserve immutable settled statement snapshots.
- Update `scripts/check-contract.mjs` and `docs/development-log.md`.

After that, continue with:

1. Negative adjustment and overpayment credit source modeling.
2. Payment lifecycle edge cases around overpayment handling.
3. Evidence-file linkage and participant data-scope filtering.

## Where To Look

- Completed chronological notes: `docs/development-log.md`
- Planned milestones: `docs/development-plan.md`
- API contract: `docs/api-design.md`
- Static contract checks: `scripts/check-contract.mjs`
- Current order-flow integration coverage: `tests/integration/purchase-preview-http.test.ts`
