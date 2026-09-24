# ProcureX Development Progress

Last updated: 2026-09-24

## Current Position

The backend is currently entering M4 settlement/read-model development.

Latest completed milestone: B06 payment preview endpoint.

Latest implementation commit:

```text
Add payment preview endpoint
```

The working tree was clean after this commit.

## Verification Baseline

The latest completed stage passed:

```bash
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration && npm run contract:check
```

Current integration coverage count at that point: 26 integration tests passing.

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
- B06 `POST /payment-records/preview`

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

Current B06 behavior:

- Statement detail lines expose stable virtual `settlementItemId` values.
- Store statement lines preview as `STORE_TO_COMPANY` payment items using sales amount plus shipment freight.
- Supplier total and supplier-store statement lines share supplier payable IDs and preview as `COMPANY_TO_SUPPLIER` items using supply amount plus shipment freight.
- Validates selected items are completed, share the same payment direction, and belong to the same paying/receiving subject.
- Returns payable amount, pending amount, confirmed paid amount, source version, and blocked items.
- Does not create payment records or reserve allocations yet.

## Recommended Next Step

Start payment record creation and allocation reservation.

Suggested first version:

- If moving into payment work, create payment records from previewed statement lines and reserve allocations.
- If continuing fulfillment finance linkage, connect RETURN discrepancy records to settlement/payment difference disposal.
- Add integration coverage to the existing purchase/supplier flow test.
- Update `scripts/check-contract.mjs` and `docs/development-log.md`.

After that, continue with:

1. Payment record creation and allocation reservation.
2. Payment confirmation, rejection, and cancellation.
3. Settlement difference disposal for accepted, replenished, and returned discrepancies.

## Where To Look

- Completed chronological notes: `docs/development-log.md`
- Planned milestones: `docs/development-plan.md`
- API contract: `docs/api-design.md`
- Static contract checks: `scripts/check-contract.mjs`
- Current order-flow integration coverage: `tests/integration/purchase-preview-http.test.ts`
