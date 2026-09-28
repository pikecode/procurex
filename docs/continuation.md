# ProcureX Continuation Handoff

Last updated: 2026-09-28

Use this as the first document when continuing development in a new window.

## Current State

M4 is locally closed against the current acceptance gates. DEV-401 through DEV-406 are closed, `npm run acceptance:m4-close` passes, Chrome is ready, local PostgreSQL is reachable, automatic evidence is complete, and the manual browser evidence package is 6/6.

M5 has resumed. The current M5 slice has a repeatable browserless acceptance chain for R01-R05 reporting/export/reconciliation, I08 in-app notification list/read/bulk-read, real DEV-503 supplier-shipment, receipt-discrepancy, discrepancy-resolution, supplier-rejection, and overdue-receipt reminder triggers, DEV-504 audit logs for purchase requests, supplier operations, shipment/receipt/discrepancy resolution, payment create/confirm/reject/cancel, W10 difference-disposal create/confirm, and store recharge/credit-limit/clearing operations, W11 visibility, R04 export task listing and failed retry, DEV-505 stale export recovery and export health monitoring/export, W13 reconciliation export/operations/notification/filterable-exportable-audit visibility, and Chrome-captured W11/W13 screenshots.

## Latest High-Signal Work

Recent commits closed M4 and restarted M5 reporting/export/operations acceptance:

```text
4351eaa Add role workbench skeleton
a8fda49 Add role views to main flow demo
f499e73 Show role evidence in main flow gate
67567d4 Add mobile main flow evidence to M5 gate
d7d1a34 Validate interactive main flow in M5 close gate
9b9e99e Add interactive main flow browser run
fd295f9 Refresh M5 browser evidence in close gate
52a46ca Include main flow UI evidence in M5 close gate
45e14b7 Show main flow demo evidence
e539f86 Show M5 close gate on W11
690bf16 Add M5 close readiness gate
e773875 Record full M5 regression baseline
2623e51 Refresh M5 acceptance evidence
559916f Show M5 status on W11
8bb8cd9 Add M5 status report
e1375c1 Export W13 export health to CSV
d218a12 Export W13 reconciliation issues to CSV
0ca1e7a Export W13 audit logs to CSV
d3bb9cf Add bulk read for in-app notifications
0649036 Notify purchasers about supplier rejections
0003eb0 Audit store funds operations
ab30908 Audit supplier order operations
c5d2d2c Add audit log filters to W13
c738288 Audit purchase request commands
5bab429 Harden settlement item locking
9679479 Record audit rows in W13 evidence capture
adbafbe Add overdue receipt reminder scan
0bd495e Audit payment record actions
d4d6614 Audit difference disposal actions
b2b21ea Add audit logs for fulfillment actions
ca3b382 Notify stores after discrepancy resolution
b7ee08c Notify suppliers about receipt discrepancies
bf3c999 Notify stores after supplier shipment
8923fde Add in-app notifications foundation
48a9cdc Add failed report export retry
16d0edd Add report export health monitoring
6f10226 Recover stale report exports
b636e45 Refresh progress ledger after W13 workbench
d4b76d5 Add W13 reconciliation workbench
65b2d92 Refresh progress ledger after R05 reconciliation
452ea4d Add R05 reconciliation issue checks
7fd6c4a Add R04 export task list
2449286 Refresh progress ledger after M5 browser evidence
387fca8 Add M5 browser evidence view
20f62b9 Refresh progress ledger after M5 acceptance chain
15b66b3 Add M5 reports acceptance chain
77e7fb2 Close M4 local acceptance gates
89e07ff Record M4 browserless acceptance after DB restore
560600d Add M4 manual evidence package check
5d21c5d Add M4 status report
cfb5762 Add local database preflight check
c5f925f Add M4 browser evidence capture
913d4e5 Add M4 manual acceptance launcher
5b3db41 Add M4 manual acceptance preflight
dfc3512 Add M4 browser runtime check
d21b77a Run manual checklist check in M4 acceptance
3bb78bc Check generated M4 manual checklist
85ebf3e Generate M4 manual acceptance checklist
e2a0fe4 Add M4 manual acceptance path
babc65a Share M4 gate definitions
5705727 Add M4 gate status command
a61c0db Add copyable M4 acceptance summary
6a38fcb Add M4 manual evidence checklist
1260b1b Map M4 gates to acceptance evidence
2eae05a Add M4 acceptance gate walkthrough
ea81b68 Add main flow demo checker
4afe8a6 Add interactive main flow demo
7db7c4d Refresh progress ledger for handoff
eaea023 Add continuation handoff document
56672e9 Add M4 acceptance summary page
4dde596 Refresh progress ledger after acceptance work
1593023 Add M4 browserless acceptance command
91bd150 Extend billing acceptance to W10 offsets
dc2e5ea Add billing acceptance checker
640a2c4 Add billing acceptance seed data
8bf55d3 Add visible main flow acceptance page
```

## Commands To Rebuild Evidence

Run the M5 reporting/export browserless chain:

```bash
npm run acceptance:m5-close
npm run m5:status
npm run acceptance:m5-browserless
npm run m5:capture-all-evidence
npm run m5:capture-browser-evidence
npm run m5:capture-ops-evidence
npm run m5:gate-status
```

The latest local run on 2026-09-28 has Docker, PostgreSQL, Chrome, M5 browserless output, and W11/W13 evidence READY. The browserless chain passed 10/10 steps, W11 capture recorded `PASSED`, M5 status `READY`, M5 gate `READY` with 9 gate rows, 1 report row, and 1 export row; W13 capture recorded 5 reconciliation issues, 0 export-health exception rows, 2 notification rows, and 16 audit rows. The follow-up full baseline also passed: build, 47 unit tests, 31 integration tests, contract check, Web check, M5 status, and diff check.

`npm run acceptance:m5-close` is now the strongest single M5 close-readiness command. It reruns the M5 browserless reporting/export/reconciliation/notification chain, reseeds/checks the main-flow demo, writes `apps/web/main-flow-demo-run.json`, writes the M5 status snapshot, refreshes W11/W13 browser evidence through `m5:capture-all-evidence`, captures the main-flow demo role/evidence card, role-view tabs, and `role-workbenches.html` role lanes in Chrome, clicks the main-flow page's one-click browser run through `main-flow:capture-interactive-demo` in desktop and mobile viewports, clicks the Store order, Purchaser confirmation, Supplier shipment, Store receipt, Supplier discrepancy, Supplier rejection reallocation, and discrepancy branch actions, runs `m5:gate-status`, and writes a final M5 status snapshot. The latest committed run marks DEV-501/502, R04/W11, DEV-505, R05/W13, DEV-503, DEV-504, MainFlowUI, MainFlowRun, and Chrome evidence as READY; the current working slice raises MainFlowRun to include a real Store role order reaching `PENDING_PROCUREMENT / PAID`, Purchaser `CONFIRMED`, Supplier `SHIPPED`, Store receipt `COMPLETED`, Supplier discrepancy `RESOLVED`, supplier rejection reallocated to a backup supplier, discrepancy `REPLENISH_PENDING/1`, and discrepancy `RESOLVED/RETURN`.

This performs:

0. `m5:status` checks Docker, local PostgreSQL, browser runtime, latest M5 browserless output, and W11/W13 evidence manifests. If Docker/PostgreSQL is down, DB-backed M5 acceptance is environment-blocked until `npm run db:up` succeeds.
1. TypeScript build.
2. `PXRPT` report acceptance seeding.
3. R01/R02/R03/R04/R05 HTTP acceptance checks.
4. Store-scope and supplier profit-permission checks.
5. R04 export task list check.
6. DEV-505 export health check: admin sees a stale `PROCESSING` job before recovery, supplier gets 403, then the worker recovers the job to READY.
7. DEV-505 failed export retry check: a FAILED job is requeued through `POST /exports/{id}/retry`, reaches READY, and a second retry returns 409.
8. I08 notification check: current-user list/read works and another user gets 404 for the admin message.
9. R05 reconciliation issue list check.
10. W11/W13 Web visibility check.

The screenshot capture logs in as `pxrpt_store`, renders the M5 acceptance summary on the W11 report page, runs the September 2026 R01 scoped query, creates an export job, waits for READY in the export task list, and writes local evidence to:

```text
var/m5-browser-evidence/reports-dashboard.png
var/m5-browser-evidence/manifest.json
var/m5-browser-evidence/ops-reconciliation.png
var/m5-browser-evidence/ops-manifest.json
```

Generated local file:

```text
apps/web/reports-acceptance-run.json
apps/web/m5-status.json
apps/web/main-flow-demo-run.json
apps/web/m5-gate-status.json
```

These files are intentionally ignored by git.

The W13 ops evidence logs in as `pxrpt_admin`, renders `GET /exports/health`, `GET /notifications`, `GET /audit-logs`, and `GET /reconciliation-issues`, and writes `ops-manifest.json` with export health, notification, audit, and reconciliation issue row counts.

Run the strongest browserless M4 chain:

```bash
npm run m4:status
npm run db:check
npm run acceptance:m4-browserless
```

This performs:

1. TypeScript build.
2. W09/W10 `PXACC` acceptance seeding.
3. W09/S05/S08 and W10 HTTP acceptance checks.
4. DEV-402/403/406 automatic gate-status check.
5. Generated manual-checklist sync check.
6. Main-flow acceptance runner.
7. Interactive main-flow demo seeding and HTTP check.
8. Web workbench visibility check.

Generated local files:

```text
apps/web/billing-acceptance-run.json
apps/web/main-flow-run.json
```

These files are intentionally ignored by git.

## What To Open

Start the local services:

```bash
npm run m4:start-manual-acceptance
```

Alternatively, start the API and web server separately with `npm run start:api` and `npm run start:web`.

Open:

```text
http://127.0.0.1:4173/m4-acceptance.html
http://127.0.0.1:4173/main-flow-demo.html
http://127.0.0.1:4173/billing.html
http://127.0.0.1:4173/main-flow.html
http://127.0.0.1:4173/
```

The root report page is now the best first M5 reporting screen: after `npm run acceptance:m5-close` and `npm run m5:status`, it displays the latest local M5 environment snapshot from `apps/web/m5-status.json`, the latest 10-step R01-R05/DEV-505 acceptance result from `apps/web/reports-acceptance-run.json`, and the M5 close-readiness gate from `apps/web/m5-gate-status.json`; it can be re-captured with `npm run m5:capture-browser-evidence`.

`ops.html` is the best first M5 operations screen: it shows DEV-505 export task health with CSV export, I08 in-app notifications with single/bulk read actions, DEV-504 filterable audit logs with current-result CSV export, and R05 reconciliation issues with CSV export for the seeded admin account.

`m4-acceptance.html` is the best first screen for review: it shows the latest browserless result, the DEV-402/403/406 gate status, structured automatic evidence coverage, the seeded account matrix, and a copyable acceptance summary. The manual evidence checkboxes are saved locally in the browser as review aids; the strict file-based close gate is `npm run m4:check-manual-evidence`.

The gate definitions live in `apps/web/m4-gates.json`; update that file first if DEV-402/403/406 acceptance evidence changes, because both the page and `m4:gate-status` read from it. The same file also drives the manual acceptance path shown on `m4-acceptance.html`.

If port `4173` is occupied, run a one-off static server on another port:

```bash
python3 -m http.server 4174 --directory apps/web
```

## Seeded Accounts

All seeded accounts use password `correct-password`.

| Account | Use |
|---|---|
| `pxflow_user` | Interactive main-flow demo from order creation to payment preview. |
| `pxflow_store` | Store-scoped main-flow notification check after supplier shipment. |
| `pxflow_supplier` | Supplier-scoped main-flow notification check after receipt discrepancy. |
| `pxacc_admin` | ADMIN/HQ finance view for all billing tabs and checks. |
| `pxacc_store` | Store-scoped billing and direct statement view. |
| `pxacc_supplier_company` | Supplier-scoped company-term view. |
| `pxacc_supplier_direct` | Supplier-scoped direct-term view. |
| `pxrpt_admin` | Company report acceptance checks and export ownership. |
| `pxrpt_store` | Store-scoped W11 report screenshot and R01/R02 scoped checks. |
| `pxrpt_supplier` | Supplier-scoped report permission boundary checks. |

More detail is in `docs/billing-acceptance-seed.md`.

For the interactive main-flow demo, run:

```bash
npm run main-flow:seed-demo
npm run main-flow:check-demo
npm run main-flow:capture-demo-evidence
npm run main-flow:capture-interactive-demo
```

The demo page renders `apps/web/main-flow-demo-run.json` as visible role and evidence sections, plus role tabs with next-workbench boundary text. `apps/web/role-workbenches.html` now renders Store/Purchaser/Supplier/Operator lanes from the same PXFLOW evidence, including account scope, todos, actions, evidence mapping, and next-page boundary text. The Store lane has a real order action that logs in as `pxflow_store`, previews the order, and creates a `PENDING_PROCUREMENT / PAID` purchase request; the Purchaser lane confirms that request to `CONFIRMED` and generates a supplier order; the Supplier lane creates a real shipment; the Store receipt action completes that shipment through the receipt API; the Supplier discrepancy action creates a short-receipt exception and resolves it to `RESOLVED`; the Supplier rejection action rejects a pushed order and has Purchaser reallocate it to a backup supplier; the discrepancy branch action covers `REPLENISH` with replenishment shipment/receipt and `RETURN` with returnRecord. The latest Chrome capture under `var/main-flow-demo-evidence/` records `PASSED`, 4 role rows, 4 role tabs, 4 role workbench lanes, 7 evidence rows, 6 step rows, and true notification/audit evidence flags. `main-flow:capture-interactive-demo` also proves the page's one-click run control can execute the browser flow against real APIs in desktop and 390px mobile viewports and that the role actions can create, confirm, ship, receive, resolve, reallocate, replenish, and return; it is now part of `acceptance:m5-close` and the `MainFlowRun` gate.

For the M4 gate status summary, run:

```bash
npm run m4:prepare-manual-acceptance
npm run m4:status
npm run m4:manual-evidence-status
npm run m4:capture-manual-evidence
npm run m4:check-browser-runtime
npm run m4:gate-status
npm run m4:capture-browser-evidence
```

For the generated manual acceptance checklist, run:

```bash
npm run m4:write-manual-checklist
npm run m4:check-manual-checklist
```

Open `docs/m4-manual-acceptance.md` when collecting screenshots or recordings.

Place collected manual evidence files under:

```text
var/m4-manual-evidence/<gate>/<manualEvidenceId>.<png|jpg|jpeg|webp|mp4|mov|webm|pdf>
```

Run `npm run m4:check-manual-evidence` before marking M4 closed.

Run `npm run acceptance:m4-close` for the final local M4 close check after browser evidence exists.

## Next Work

Do these in order:

1. Keep `npm run acceptance:m5-browserless`, `npm run m5:capture-browser-evidence`, and `npm run m5:capture-ops-evidence` green after M5 changes.
2. Continue M5 in plan order: deepen DEV-503 by adding the next business notification trigger, or continue DEV-504 audit expansion if operations evidence is more urgent.
3. Run `npm run acceptance:m4-close` after any billing, payment, settlement, or adjustment change.

Do not reopen M4 unless a regression appears in `acceptance:m4-close` or a reviewer rejects the collected browser evidence.
