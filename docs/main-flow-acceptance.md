# Main Flow Acceptance

Last updated: 2026-09-30

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

The flow is implemented across backend APIs, the formal Web product app, and a native mini-program product-client slice. The formal Web journey has interactive browser evidence through payment confirmation; the native mini-program journey has real-API flow evidence. These are distinct acceptance claims: local API checks do not prove WeChat Developer Tools or real-device compatibility, and the Web App is not a substitute for the mini-program deliverable.

## Acceptance Matrix

| Step | Requirement | Implemented Surface | Current Evidence | Visible UI | Gap |
|---|---|---|---|---|---|
| 1. Store order preview | O01, DEV-201 | `POST /purchase-requests/preview` | Integration, Web App interactive flow, native mini-program API flow | `app.html#/store`; native Store page | WeChat device acceptance remains open |
| 2. Store order creation | O02, DEV-201/202 | `POST /purchase-requests` | Idempotent API coverage and real-API actions in both clients | `app.html#/store`; native Store page | Device acceptance remains open |
| 3. Purchase request read | O03 | list/detail endpoints | Scope tests; formal App and mini-program flow exercise | `app.html#/purchaser`; native Purchaser page | Broader device/role usability review |
| 4. Procurement assign/confirm | O04-O07, DEV-204/205 | edit/assign/confirm endpoints | API coverage; formal App confirmation evidence; mini flow confirmation | Formal Purchaser route; native Purchaser page | Dedicated formal App reallocation action evidence |
| 5. Supplier rejection/reallocation | O09-O10, DEV-305 | reject/reallocate endpoints | Formal Web independent rejection; mini-program API-flow reallocation | Purchaser and Supplier role pages in both clients | Formal App reallocation click evidence; WeChat device acceptance |
| 6. Supplier order read | F01 | list/detail endpoints | Scope tests and real-API role journeys | `app.html#/supplier`; native Supplier page | WeChat device acceptance remains open |
| 7. Shipment preview/create | F02-F03, DEV-301/302 | preview and shipment endpoints | Formal Web role action and native API flow | Supplier routes in both clients | WeChat device acceptance remains open |
| 8. Store receipt | F04, DEV-303 | `POST /shipments/{id}/receipts` | Formal Web role action and native API flow, including short receipt | Store routes in both clients | WeChat device acceptance remains open |
| 9. Discrepancy resolution | F05, DEV-304 | `POST /discrepancies/{id}/resolve` | Web ACCEPT/REPLENISH/RETURN browser evidence; native API flow resolution | Supplier routes in both clients | Real-device and broader exception acceptance |
| 10. Store/supplier statements | B01-B04, DEV-402/403 | statement endpoints | Database/HTTP acceptance and browser evidence | `apps/web/billing.html`; native Supplier statement view | Native statement-view device acceptance |
| 11. Payment registration | B06-B07, DEV-404 | preview/create payment with evidence | HTTP acceptance and formal Web App deterministic action | Finance route; billing page | Native customer finance/device sign-off |
| 12. Receiver confirmation | B08, DEV-404 | payment confirmation | Formal Web browser evidence and native API-flow confirmation | Supplier routes in both clients | WeChat device acceptance remains open |
| 13. Adjustments and difference disposal | B05/B12, DEV-406 | adjustment reads, offline return, offset, receiver confirmation | HTTP/database and W10 browser evidence | W10 in `apps/web/billing.html` | Native role exposure not evidenced; verify against approved role needs |

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

`apps/web/role-workbenches.html` is the first role-specific product split from the operator demo. It renders Store, Purchaser, Supplier, and Operator lanes from the same PXFLOW seed/run output, with account scope, current todos, action boundaries, mapped main-flow evidence, and next-page boundary text. The Store lane includes a real order action: it logs in as `pxflow_store`, previews the seeded item, and creates a `PENDING_PROCUREMENT / PAID` purchase request through the real API. The Purchaser lane then confirms that request through `/purchase-requests/{id}/confirm`, reaches `CONFIRMED`, and returns the generated supplier order id. The Supplier lane logs in as `pxflow_supplier`, previews and creates a shipment through `/supplier-orders/{id}/shipment-preview` and `/supplier-orders/{id}/shipments`, and the Store receipt action calls `/shipments/{id}/receipts` to reach `COMPLETED`. The Supplier discrepancy action creates a separate short-receipt exception and calls `/discrepancies/{id}/resolve` to reach `RESOLVED`; the supplier rejection action rejects a pushed order and has Purchaser call `/purchase-requests/{id}/reallocate` to reallocate the item to the backup supplier; the discrepancy branch action covers `REPLENISH` with a replenishment shipment/receipt and `RETURN` with a returnRecord. The remaining role-specific work is mobile/browser breadth and production readiness, not core API reachability.

Chrome-rendered evidence can be refreshed with:

```bash
npm run main-flow:capture-demo-evidence
```

The latest local capture wrote `var/main-flow-demo-evidence/main-flow-demo.png`, `role-workbenches.png`, and a manifest with `PASSED`, 4 role rows, 4 role tabs, 4 role workbench lanes, 7 evidence rows, 6 visible operation steps, next-workbench/next-page boundary text, and true notification/audit evidence flags.

To prove the browser page itself can execute the full path against real APIs, run:

```bash
npm run main-flow:capture-interactive-demo
```

This command prepares the PXFLOW seed, refreshes the role evidence, starts API/Web as needed, clicks "一键执行" in Chrome for desktop and 390px mobile main-flow viewports, then opens `role-workbenches.html` in desktop and 390px mobile viewports and clicks the Store role order action, Purchaser confirmation action, Supplier shipment action, Store receipt action, Supplier discrepancy action, Supplier rejection reallocation action, and discrepancy REPLENISH/RETURN branch action. It waits for 6/6 operation rows and `COMPANY_TO_SUPPLIER` in both main-flow viewports, waits for the Store action to create `PENDING_PROCUREMENT / PAID`, waits for the Purchaser action to reach `CONFIRMED`, waits for the Supplier action to reach `SHIPPED`, waits for the Store receipt action to reach `COMPLETED`, waits for the discrepancy action to reach `RESOLVED`, waits for the rejection handling action to reach `REALLOCATED`, waits for the branch action to reach `BRANCHES_READY`, then writes `var/main-flow-demo-evidence/main-flow-demo-interactive.png`, `main-flow-demo-interactive-mobile.png`, `role-workbenches-interactive.png`, `role-workbenches-interactive-mobile.png`, and `interactive-manifest.json`. The latest local interactive capture reached `COMPANY_TO_SUPPLIER / ¥90.00`, created a Store role purchase request for `120.00`, confirmed it into a supplier order, shipped it, received it, resolved a short-receipt discrepancy, reallocated a supplier rejection to the backup supplier, covered `REPLENISH_PENDING/1` and `RESOLVED/RETURN`, and recorded no page-level mobile horizontal overflow.

## What This Means

The core business flow is no longer backend-only: a formal Web product app and a native mini-program client both exercise real APIs. Local browser/API evidence is strong, but the deliverable is not production complete: WeChat Developer Tools/real-device behavior, customer acceptance, and M6 infrastructure/sign-offs remain distinct gates.

## Direction Assessment

The original dual-client requirement remains represented: the Web App has browser-executed role actions and the native mini-program has a real-API role-flow check. Recent M7 effort has concentrated on Web usability/evidence; this is acceptable as a distinct client track, not as a substitute for the original mini-program acceptance. The concrete local gap is deterministic Purchaser reallocation action evidence in the formal App, followed by an acceptance audit of both clients. Real WeChat device and production checks remain external M6 gates.

## Recommended Next Step

Complete the dual-client requirement audit and close local role-flow gaps; keep WeChat device and production launch evidence explicitly open under M6.
