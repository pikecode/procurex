# ProcureX Development Progress

Last updated: 2026-09-24

## Current Position

The backend is currently in M3 fulfillment development.

Latest completed milestone: A06 recharge detail lookup.

Latest implementation commit:

```text
Add recharge detail lookup
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
- Supports ACCEPT and REPLENISH resolution in this version.
- ACCEPT persists a discrepancy action record and marks the discrepancy RESOLVED.
- REPLENISH persists a discrepancy action record, marks the discrepancy REPLENISH_PENDING, and creates a replenishment gap with pending quantity.
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
- F04 currently supports first receipt creation only. Receipt revision replacement is not implemented yet.
- F05 currently supports ACCEPT and REPLENISH. RETURN still requires a return model.
- Settlement and reconciliation remain future work.
- Frontend pages are not implemented yet.

### Store Finance

Implemented interfaces:

- A01 `GET /stores/{id}/account`, `GET /stores/{id}/ledgers`
- A02 `POST /stores/{id}/recharges`
- A03 `PATCH /stores/{id}/credit-limit`
- A06 `GET /recharges/{id}` (recharge detail only)

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

## Recommended Next Step

Start A04/A05 clearing previews, or add receipt revision replacement.

Suggested first version:

- If continuing fulfillment work, add receipt revision replacement.
- If continuing finance work, add A04/A05 clearing previews and clearing documents.
- Add integration coverage to the existing purchase/supplier flow test.
- Update `scripts/check-contract.mjs` and `docs/development-log.md`.

After that, continue with:

1. Replenishment gap tracking for shortages.
2. O11 funding reconciliation.
3. Finance/settlement modules.

## Where To Look

- Completed chronological notes: `docs/development-log.md`
- Planned milestones: `docs/development-plan.md`
- API contract: `docs/api-design.md`
- Static contract checks: `scripts/check-contract.mjs`
- Current order-flow integration coverage: `tests/integration/purchase-preview-http.test.ts`
