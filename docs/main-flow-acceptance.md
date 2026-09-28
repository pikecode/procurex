# Main Flow Acceptance

Last updated: 2026-09-27

This is the primary product-flow checkpoint. It exists to prevent the project from drifting into isolated details while the core ordering flow remains unclear.

## Core Flow

The main business flow is:

```text
Store order
→ procurement confirmation and supplier split
→ supplier shipment
→ store receipt
→ discrepancy handling when needed
→ statement generation
→ payment registration with evidence
→ receiver confirmation
```

This flow is mostly implemented in the backend and covered by integration tests. It is not yet fully visible as an end-to-end browser or mini-program demo.

## Acceptance Matrix

| Step | Requirement | Implemented Surface | Current Evidence | Visible UI | Gap |
|---|---|---|---|---|---|
| 1. Store order preview | O01, DEV-201 | `POST /purchase-requests/preview` | Integration coverage for catalog pricing and stored-value shortfall | Not yet in Web; expected S01/S02/代下单 UI remains future work | Need visible order-entry page or scripted demo |
| 2. Store order creation | O02, DEV-201/202 | `POST /purchase-requests` | Idempotent creation integration coverage | Not yet in Web | Need visible order creation workflow |
| 3. Purchase request read | O03 | `GET /purchase-requests`, `GET /purchase-requests/{id}` | Store-scope read hardening covered | Not yet in Web | Need purchaser/order list UI |
| 4. Procurement edit/assign/confirm | O04-O07, DEV-204/205 | item patch, assign/reassign-preview, confirm | Integration flow splits supplier orders once per idempotency key | Not yet in Web | Need W01/W02 visible workflow |
| 5. Supplier rejection/reallocation | O09-O10, DEV-305 | supplier reject, purchaser reallocate | Integration coverage for supplier rejection and reallocation | Not yet in Web/S09 | Need visible exception queue |
| 6. Supplier order read | F01 | `GET /supplier-orders`, detail | Supplier scope hardening covered | Not yet in Web/S06 | Need supplier order list/detail UI |
| 7. Shipment preview/create | F02-F03, DEV-301/302 | shipment preview and creation | Integration covers shipment, freight confirmation use, replenishment allocation | Not yet in Web/S06 | Need visible supplier shipment UI |
| 8. Store receipt | F04, DEV-303 | `POST /shipments/{id}/receipts` | Integration covers receipt revisions, short receipt, replacement | Not yet in Web/S04 | Need visible receipt UI |
| 9. Discrepancy resolution | F05, DEV-304 | `POST /discrepancies/{id}/resolve` | ACCEPT, REPLENISH, RETURN covered through backend flows | Not yet in Web/S07/W04 | Need visible supplier discrepancy UI |
| 10. Store/supplier statements | B01-B04, DEV-402/403 | store, supplier total, supplier-store, direct statements | 31 integration tests and statement-specific evidence | W09/S05/S08 in `apps/web/billing.html` | Browser E2E still blocked |
| 11. Payment registration | B06-B07, DEV-404 | preview/create payment with evidence file | Required PAYMENT evidence and idempotency covered | W09/S05/S08 in `apps/web/billing.html` | Browser E2E still blocked |
| 12. Receiver confirmation | B08, DEV-404 | payment confirmation | Receiver authorization and direct/company gates covered | W09/S05/S08 in `apps/web/billing.html` | Browser E2E still blocked |
| 13. Adjustments and difference disposal | B05/B12, DEV-406 | adjustment reads, offline return, offset, receiver confirmation | B05 to B12 HTTP/database flow covered | W10 section in `apps/web/billing.html` | Browser E2E still blocked |

## Scripted Acceptance Runner

Run this after building:

```bash
npm run build
npm run acceptance:main-flow
```

The runner starts a temporary local API instance, creates isolated test master data, and executes:

```text
purchase request creation
→ procurement confirmation
→ supplier shipment
→ store receipt
→ store statement read
→ supplier statement read
→ supplier payment preview
```

It prints the created IDs, statuses, and amounts for each step, then cleans up the seeded data. This is not a browser replacement, but it is the fastest repeatable proof that the main backend path reaches the billing/payment handoff.

After a successful run, the runner also writes `apps/web/main-flow-run.json`. Open `apps/web/main-flow.html` through `npm run start:web` to review the latest status, step table, completion state, and payment-preview amount from the browser.

Latest local result: the runner passed and printed a complete flow with `PENDING_PROCUREMENT → CONFIRMED/PUSHED → SHIPPED → COMPLETED → store statement OPEN → supplier payable preview COMPANY_TO_SUPPLIER 90.00`.

## Interactive Demo

Run:

```bash
npm run build
npm run main-flow:seed-demo
npm run start:api
npm run start:web
```

Open `http://127.0.0.1:4173/main-flow-demo.html`.

The demo uses `PXFLOW` seed data and account `pxflow_user` / `correct-password`. It drives the existing APIs in order:

```text
login
→ purchase request creation
→ procurement confirmation
→ supplier shipment
→ store receipt
→ supplier statement read
→ supplier payment preview
```

This is a narrow operator workbench for manual visibility. The repeatable proof remains `npm run acceptance:main-flow` and `npm run acceptance:m4-browserless`.

The page can run those steps either one by one or with the "一键执行" control.

The demo flow can also be verified without a browser:

```bash
npm run main-flow:seed-demo
npm run main-flow:check-demo
```

`main-flow:check-demo` also writes `apps/web/main-flow-demo-run.json`. The operator demo renders that file as "角色复核", "分角色视图", and "主流程证据" sections covering Operator, Store, Supplier, and Purchaser evidence, role-specific next-workbench boundaries, shipment notification, receipt-discrepancy notification, discrepancy-resolution notification, supplier-rejection notification, audited order/fulfillment actions, and the supplier payment preview.

`apps/web/role-workbenches.html` is the first role-specific product split from the operator demo. It renders Store, Purchaser, Supplier, and Operator lanes from the same PXFLOW seed/run output, with account scope, current todos, action boundaries, mapped main-flow evidence, and next-page boundary text. The Store lane includes a real order action: it logs in as `pxflow_store`, previews the seeded item, and creates a `PENDING_PROCUREMENT / PAID` purchase request through the real API. The Purchaser lane then confirms that request through `/purchase-requests/{id}/confirm`, reaches `CONFIRMED`, and returns the generated supplier order id. The remaining role-specific operation buttons still need to be connected to supplier/receipt/discrepancy workflows.

Chrome-rendered evidence can be refreshed with:

```bash
npm run main-flow:capture-demo-evidence
```

The latest local capture wrote `var/main-flow-demo-evidence/main-flow-demo.png`, `role-workbenches.png`, and a manifest with `PASSED`, 4 role rows, 4 role tabs, 4 role workbench lanes, 7 evidence rows, 6 visible operation steps, next-workbench/next-page boundary text, and true notification/audit evidence flags.

To prove the browser page itself can execute the full path against real APIs, run:

```bash
npm run main-flow:capture-interactive-demo
```

This command prepares the PXFLOW seed, refreshes the role evidence, starts API/Web as needed, clicks "一键执行" in Chrome for desktop and 390px mobile viewports, then opens `role-workbenches.html` and clicks the Store role order action followed by the Purchaser confirmation action. It waits for 6/6 operation rows and `COMPANY_TO_SUPPLIER` in both main-flow viewports, waits for the Store action to create `PENDING_PROCUREMENT / PAID`, waits for the Purchaser action to reach `CONFIRMED`, then writes `var/main-flow-demo-evidence/main-flow-demo-interactive.png`, `main-flow-demo-interactive-mobile.png`, `role-workbenches-interactive.png`, and `interactive-manifest.json`. The latest local interactive capture reached `COMPANY_TO_SUPPLIER / ¥90.00`, created a Store role purchase request for `120.00`, confirmed it into a supplier order, and recorded no page-level mobile horizontal overflow.

## What This Means

The backend main flow is broad and largely connected. A narrow Web demo now exists and renders persisted role, notification, and audit evidence, but the full role-specific product flow is still incomplete:

- Role-specific supplier shipment with real buttons beyond the role workbench skeleton.
- Role-specific store receipt with real buttons beyond the role workbench skeleton.
- Role-specific supplier discrepancy handling with real buttons beyond the role workbench skeleton.

The visible work currently starts mainly at billing and payment.

## Direction Assessment

The project has not abandoned the original demand, but the execution has become backend-heavy and settlement-heavy. That is useful for correctness, but it is not enough for user confidence.

The next visible-product priority is:

The scripted runner, browser-readable result page, narrow operator demo, role evidence checker, role-view tabs, role workbench lanes, real Store role order action, real Purchaser confirmation action, desktop interactive capture, and mobile interactive capture are now in place. The next product-facing step is to connect the Supplier shipment and Store receipt workbench lanes to real role-specific API actions.

## Recommended Next Step

Keep M5 close evidence green while evolving `role-workbenches.html` from Store/Purchaser actions into supplier shipment, store receipt, and supplier discrepancy workbenches.
