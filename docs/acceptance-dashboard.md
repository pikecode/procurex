# ProcureX Acceptance Dashboard

Last updated: 2026-09-28

This file is the visible checkpoint for product direction. It maps implemented work back to the plan, shows what can be tried locally, and lists the remaining acceptance gaps. Start with `docs/continuation.md`, then use this file with `docs/progress.md` before starting new work.

For the exact M4 closure checklist, use `docs/m4-exit-checklist.md`.

For the end-to-end ordering-to-payment flow, use `docs/main-flow-acceptance.md`. It separates backend evidence from what is actually visible to a user.

## Direction Check

The current direction is aligned with the confirmed plan: M4 settlement, billing, payment, clearing, and adjustment acceptance is locally closed, and work has resumed on M5 reporting/operations.

There was one recorded deviation: R01-R04 and W11 reporting/export work started before M4 was fully accepted. That has been corrected by closing M4 locally first; current M5 work is now in the planned reporting/export/operations lane.

## Current Gate Status

| Package | Status | Why |
|---|---|---|
| DEV-401 historical repricing | Closed | P01-P03, run processing, completed-order exclusion, and concurrency/order tests are covered. |
| DEV-402 amount and period logic | Closed | B01-B04, settlement-mode evidence, credit-limit guard, and W09/S05/S08 browser evidence are covered in the local close gate. |
| DEV-403 statement families | Closed | Store, supplier total, supplier-store, and direct statements have automatic evidence and browser evidence in the local close gate. |
| DEV-404 payment lifecycle | Closed | B06-B11, evidence files, receiver authorization, direct/company payment gates, and concurrency are covered. |
| DEV-405 clearing | Closed | A04-A06 selected-credit clearing, ledger/account updates, scope checks, and local restore evidence are covered. |
| DEV-406 adjustments and difference disposal | Closed | B05/B12, persisted adjustments, returns, offsets, overpayments, W10 workbench, and browser evidence are covered in the local close gate. |
| DEV-501/502 reporting and export | Active | R01-R04 and W11 are implemented with browserless acceptance, CSV export, task listing, and Chrome evidence. |
| DEV-503 notifications | Active | I08 in-app notification list/read/bulk-read and owner isolation are implemented, seeded, visible on W13; supplier shipment creates store "待收货提醒", receipt discrepancy creates supplier "收货差异待处理", discrepancy resolution notifies the store, supplier rejection notifies ADMIN/PURCHASER, and overdue unreceived shipments create de-duplicated store reminders. |
| DEV-504/505 operations and recovery | Active | R05/W13 reconciliation is visible and exportable; audit logs are queryable/filterable/exportable for purchase requests, supplier operations, shipment, receipt, discrepancy resolution, payment create/confirm/reject/cancel, W10 difference-disposal create/confirm, and store recharge/credit-limit/clearing operations; stale export recovery, export health monitoring/export, and failed export retry are covered for R04. |

Latest M5 local evidence on 2026-09-28: `npm run acceptance:m5-browserless` passed 10/10 steps, `npm run m5:status` reports Docker/PostgreSQL/Chrome/W11/W13 evidence READY, `m5:capture-browser-evidence` refreshed W11 with `PASSED`, M5 status `READY`, M5 gate `READY`, 9 gate rows, 1 report row, and 1 export row; `m5:capture-ops-evidence` refreshed W13 with 5 reconciliation issues, 0 export-health exception rows, 2 notification rows, and 16 audit rows. The follow-up regression baseline passed build, 47 unit tests, 31 integration tests, contract check, Web check, M5 status, and diff check.

Latest M5 close-readiness gate: `npm run acceptance:m5-close` passed on the latest committed evidence and `m5:gate-status` marks DEV-501/502, R04/W11, DEV-505, R05/W13, DEV-503, DEV-504, MainFlowUI, MainFlowRun, and Chrome evidence READY. MainFlowUI now includes 4 visible role rows, 4 role tabs, and 4 role workbench lanes for Operator, Store, Supplier, and Purchaser, including next-workbench and next-page boundary text. The current working slice extends MainFlowRun so the Chrome-clicked role workbench sequence reaches Store `PENDING_PROCUREMENT / PAID`, Purchaser `CONFIRMED`, Supplier `SHIPPED`, Store receipt `COMPLETED`, Supplier discrepancy `RESOLVED`, supplier rejection handling `REALLOCATED`, and the main operator demo still reaches `COMPANY_TO_SUPPLIER / ¥90.00` with no page-level mobile horizontal overflow. This does not claim production launch readiness; multi-supplier reallocation, replenishment/return discrepancy branches, WeChat adaptation, and M6 production operations policy remain open.

## Visible Workbenches

Run the API and web static server after building:

```bash
npm run build
npm run start:api
npm run start:web
```

Open these pages:

| Page | File | What It Shows | Status |
|---|---|---|---|
| W09/S05/S08 billing | `apps/web/billing.html` | Four statement families, statement detail, payment preview, payment registration with evidence upload, receiver confirmation, payment list, evidence download. | Locally closed with browser evidence. |
| W10 adjustments | `apps/web/billing.html` adjustment views | Adjustment filtering, original vs actual period comparison, detail, B12 offline return, receiver confirmation, offset to positive adjustment. | Locally closed with browser evidence. |
| W11 reporting | `apps/web/index.html` | M5 environment status, M5 close-readiness gate, R01-R05 acceptance summary, R01-R03 reports, filters, summaries, CSV/export flow, export task list, failed export retry. | Active M5 screen; Chrome evidence captured. |
| W13 operations | `apps/web/ops.html` | DEV-505 export health monitoring with CSV export, I08 in-app notifications with single/bulk read actions, DEV-504 filterable/exportable audit logs, and R05 reconciliation issue list with CSV export. | Active M5 screen; Chrome evidence captured. |
| M4 acceptance summary | `apps/web/m4-acceptance.html` | Latest browserless M4 acceptance output, W09/S05/S08 checks, W10 offset confirmation, and main-flow runner evidence. | Implemented; reads local JSON generated by `npm run acceptance:m4-browserless`. |
| Main order flow | `npm run acceptance:main-flow` and `apps/web/main-flow.html` | Store order, procurement confirmation, supplier shipment, store receipt, statement read, supplier payment preview. | Scripted acceptance runner passes and writes a browser-readable result page; interactive Web/mini-program flow is still missing. |
| Main flow operator demo | `npm run main-flow:seed-demo`, `npm run main-flow:check-demo`, `npm run main-flow:capture-demo-evidence`, `npm run main-flow:capture-interactive-demo`, and `apps/web/main-flow-demo.html` | Login, order creation, procurement confirmation, supplier shipment, store receipt, supplier statement, payment preview, one-click browser execution, narrow-screen layout, role evidence and role tabs for Operator/Store/Supplier/Purchaser, plus notification/audit evidence from `main-flow-demo-run.json`. | Implemented as a narrow Web demo using real APIs and `PXFLOW` seed data; command checker, role evidence capture, role-view capture, static evidence capture, desktop interactive Chrome run, and mobile interactive Chrome run pass. |
| Role workbenches | `apps/web/role-workbenches.html`, `npm run main-flow:capture-demo-evidence`, and `npm run main-flow:capture-interactive-demo` | Store, Purchaser, Supplier, and Operator lanes with account scope, current todos, actions, main-flow evidence mapping, next-page boundaries, plus real Store order, Purchaser confirmation, Supplier shipment, Store receipt, Supplier discrepancy, and supplier rejection handling actions. | Store lane can create a `PENDING_PROCUREMENT / PAID` purchase request; Purchaser confirms it to `CONFIRMED`; Supplier ships it to `SHIPPED`; Store receipt completes it to `COMPLETED`; Supplier resolves a short receipt to `RESOLVED`; supplier rejection is handled through purchase-request reallocation cancellation to `REALLOCATED`; Chrome capture and `MainFlowRun` gate verify the actions and screenshot output. |

## Requirement-To-Evidence Map

| Requirement Area | Implemented Evidence | Remaining Gap |
|---|---|---|
| Purchase order split and supplier execution | O01-O11, F01-F07 integration flows and scope hardening. | Full browser/mobile user acceptance. |
| Store receiving and discrepancy handling | Receipt revisions, ACCEPT/REPLENISH/RETURN, replenishment gaps, difference disposal links, and visible main-flow demo evidence for shipment/discrepancy/rejection notifications. | Full role-specific browser/mobile acceptance. |
| Stored-value and credit finance | Account, recharge, credit limit, clearing, credit-limit guard, selected-only clearing. | Production initialization and finance sign-off. |
| Four statement families | B01 store, B02 supplier total, B03 supplier-store, B04 direct statements. | Browser-level W09/S05/S08 acceptance. |
| Payment and evidence | B06-B11, private file upload/download, required PAYMENT evidence, participant authorization. | Production storage policy and deployment configuration. |
| Price change and adjustments | P01-P03, persisted adjustment documents, repeated-change netting, B05 reads, B12 returns/offsets. | Browser-level W10 acceptance and final M4 closure review. |
| Reporting/export/operations | R01-R05 backend, W11 report page, W13 operations page, R04 export recovery, export health monitoring, failed export retry, I08 in-app notification list/read/bulk-read, supplier-shipment notification trigger, receipt-discrepancy notification trigger, discrepancy-resolution notification trigger, supplier-rejection notification trigger, overdue receipt reminders, and broad order/payment/finance audit-log coverage. | Remaining M5 work is mainly broader browser/mobile acceptance, WeChat adaptation, and recovery only for newly implemented async flows; add more notification/audit triggers only where a user-facing operation still lacks operational visibility. |

## Verification Commands

The backend acceptance baseline is:

```bash
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration && npm run contract:check
```

The browserless workbench visibility check is:

```bash
npm run web:check
```

The fastest M5 orientation check is:

```bash
npm run m5:status
```

The strongest M5 close-readiness check is:

```bash
npm run acceptance:m5-close
```

It refreshes W11/W13 Chrome evidence, main-flow demo evidence, the interactive one-click main-flow browser run in desktop and mobile viewports, and the M5 gate summary in one run.

The current browserless M4 acceptance chain is:

```bash
npm run acceptance:m4-browserless
```

For local manual billing acceptance data:

```bash
npm run billing:seed-acceptance
npm run billing:check-acceptance
```

Use `docs/billing-acceptance-seed.md` for the seeded accounts and expected W09/S05/S08 evidence. The checker also verifies one W10 positive/negative adjustment offset and confirmation path.

For the interactive main-flow operator demo:

```bash
npm run main-flow:seed-demo
npm run main-flow:check-demo
```

The latest progress ledger records a successful M5 regression baseline with 47 unit tests and 31 integration tests after the W11/W13 evidence refresh. Always rerun the full baseline before marking a package closed.

## Browser Evidence

Google Chrome is available locally and is used by the evidence capture scripts. Current browser evidence is local and file-based, not a remote CI browser suite.

Use these checks for visible workbench confidence:

- API integration tests.
- Static HTTP smoke checks.
- JavaScript syntax checks.
- `npm run web:check`, which confirms W09/W10/W11/W13 entry points and required controls remain present.
- `npm run m5:capture-browser-evidence` and `npm run m5:capture-ops-evidence` for Chrome-rendered M5 screenshots.
- `npm run acceptance:m4-close` for the local M4 close gate.

## Next Work Order

1. Keep the M5 close-readiness chain green after changes: `npm run acceptance:m5-close`.
2. Move remaining product risk to broader browser/mobile acceptance and WeChat adaptation rather than adding more low-value M5 backend details.
3. Extend recovery monitoring only when another implemented asynchronous flow needs it.
4. Run `npm run acceptance:m4-close` after any M4-domain code change.

Do not reopen M4 unless the close gate regresses or collected browser evidence is rejected.
