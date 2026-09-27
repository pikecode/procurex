# ProcureX Development Progress

Last updated: 2026-09-27

## Current Position

For new-window continuation, start with `docs/continuation.md`.

M4 is locally closed against the current acceptance gates: DEV-401 through DEV-406 are closed, `acceptance:m4-close` passes, and the W09 billing plus W10 adjustment workbenches have browser evidence. M5 reporting/export has resumed with a repeatable browserless acceptance chain, browser-visible W11 acceptance summary, W13 operations view, DEV-505 export recovery/health/retry coverage, DEV-503 in-app notifications connected to supplier shipment/receipt discrepancy/discrepancy resolution events, and the first DEV-504 audit log slice.

Latest follow-up audit also closes two remaining store-scope reads: recharge detail accepts STORE_FINANCE and rejects another store, and store catalog reads reject unconfigured or mismatched STORE/STORE_FINANCE scopes.

Purchase request O03 list/detail reads now also accept STORE_FINANCE and force the authenticated store scope; mismatched list filters are rejected and cross-store details resolve as not found.

Supplier order F01 list/detail reads now force the authenticated SUPPLIER scope; mismatched supplier filters are rejected and cross-supplier details resolve as not found.

Supplier order F02/F03/F06/F09 supplier-side mutations now carry the configured supplier scope through preview, shipment creation, freight confirmation, and rejection lookups.

F04 discrepancy resolution also carries the configured supplier scope through its order-item relation.

F04 receipt creation now carries the configured STORE/STORE_FINANCE scope through the shipment's supplier-order relation.

O01/O02 preview and create now reject a configured store account's request for another store.

DEV-401 now has HTTP acceptance coverage for P01 impact preview, P02 publish, P03 run status/process/replay, and version history; the preview confirms a no-impact scope returns zero deltas.

DEV-402/404 now have a full direct supplier-term HTTP acceptance path: B04 list/detail includes goods and freight, B06 previews STORE_TO_SUPPLIER on DIRECT channel, B07 registration replays idempotently, B08 supplier confirmation settles the statement, and the confirmed goods/freight snapshot remains persisted.

DEV-402 AT-17 is covered over HTTP: lowering a store credit limit below used credit returns CREDIT_LIMIT_BELOW_USED and leaves both the limit and outstanding used credit unchanged.

DEV-404 direct-payment role boundaries are covered in the same HTTP flow: SUPPLIER cannot initiate payment preview and STORE cannot confirm its own payment; supplier confirmation succeeds.

DEV-402 AC-21 now has explicit integration evidence: a completed STORED_VALUE supplier order still appears as a COMPANY supplier payable with its goods and freight amount in the supplier statement/payment preview.

DEV-403 immediate-cycle grouping now has unit evidence for all four statement views: store, direct, supplier total, and supplier-store each keep same-day execution orders in separate statements.

DEV-403 AC-20 now proves cross-view reservation consistency: registering the shared supplier payable from a supplier-store statement makes the same item show zero payable and the full pending amount from the supplier-total statement.

DEV-404 company-term ordering now has HTTP acceptance: the supplier payable is blocked with STORE_RECEIVABLE_UNSETTLED until the store payment is confirmed; afterward B06 exposes the company supplier payable.

DEV-405 W08 clearing now has stronger HTTP/database evidence: clearing one selected 200 credit leaves an unselected 50 credit outstanding, preserves the 240 cumulative net-paid amount and 320.50 cash balance, and records a 200 debit clearing ledger row.

DEV-406 database acceptance now covers two successive price runs after an 80.00 supplier payable snapshot: the snapshot stays 80.00, deltas of +20.00 and +10.00 persist once each, and B05/B01-B04 reconcile the net +30.00 adjustment without rewriting the base.

DEV-406 positive adjustment payments now have direct-term HTTP evidence: B06 previews a persisted +20.00 adjustment as STORE_TO_SUPPLIER/DIRECT; B07 registers and B08 confirms it; B04 reflects the confirmed payment and SETTLED state while the original goods/freight snapshot stays unchanged.

Latest completed implementation: the four statement families, payment records, adjustments, difference disposals, and clearing details now enforce authenticated store scope for both STORE and STORE_FINANCE accounts; cross-scope IDs resolve as not found, while company roles retain broad access. B01–B04 expose persisted adjustment amounts and adjustment settlement item IDs in their actual settlement period; B06–B08 now preview, register, and confirm positive adjustment payments through the existing allocation path without turning them into order overpayments; statement payment summaries and settlement status include those positive adjustment allocations; company-term supplier adjustments also wait for the related store receivable and positive store adjustments to settle; negative adjustments remain B12 credits. Price adjustment documents use the same left-closed, right-open period key as statements; B05 reads persisted settled-side adjustment documents and their side-specific disposal status; P03 writes them transactionally.

Latest recovery evidence: an independent PostgreSQL backup/restore drill completed against the local database. Backup capture took 237ms and restore plus verification took 521ms. The restored database preserved 5 supplier orders, 4 payment records, 4 stores, and a READY PAYMENT FileObject; the restored private evidence file matched its source SHA-256. This is local AT-24 evidence; production backup policy and the RPO/RTO target remain DEV-603/M6 work.

Latest W09/S05/S08 verification: the local API health endpoint and `billing.html` served successfully, `billing.js` passed syntax checking, and the full backend baseline passed with 36 unit tests, 31 integration tests, build, contract check, and diff check. Google Chrome is available locally, and DEV-402/403/406 browser evidence has been collected under `var/m4-manual-evidence/`.

W10 workbench now provides adjustment filtering, original/actual period comparison, detail, B12 offline-return registration and receiver confirmation, plus offsets to a selected positive adjustment on the same settlement side. A real-database HTTP test now follows a negative price adjustment through B05 list/detail into B12 creation and receiver confirmation. B05 exposes actionable source/target IDs only when a price adjustment maps to one persisted document; ambiguous multi-run netting remains read-only. Browser E2E remains open. Verification: 36 unit tests, 31 integration tests, build, contract check, Web syntax, HTTP smoke, diff check, and the targeted W10 HTTP test pass.

`npm run web:check` now provides a browserless visibility guard for W09/W10/W11. It verifies the billing page, adjustment section, payment/evidence controls, difference-disposal controls, report page, JavaScript syntax, and required web assets. It is not a replacement for browser E2E, but it prevents silent removal of the visible workbench entry points.

`npm run acceptance:m5-browserless` now covers the M5 reporting/export/reconciliation/notification slice. It builds the project, seeds isolated `PXRPT` data, verifies R01 scoped completed-order amount, R02 product quantity and three-month range rejection, R03 profit excluding direct supplier-term orders with freight separate, R04 export job READY plus CSV download and task listing, DEV-505 export health detection plus recovery of a stale `PROCESSING` export job, failed export retry through `POST /exports/{id}/retry`, I08 notification list/read and owner isolation, R05 account reconciliation mismatches, store-scope enforcement, supplier profit denial, and W11/W13 Web visibility. The latest run passed and wrote `apps/web/reports-acceptance-run.json`.

`apps/web/index.html` now renders the latest M5 browserless result from `reports-acceptance-run.json` inside the W11 report page. It also shows the latest export tasks with READY/FAILED/processing status, retry for failed jobs, and download actions backed by `GET /exports`. `npm run m5:capture-browser-evidence` logs in as the store-scoped report account, loads the M5 acceptance summary, runs the R01 September 2026 query, creates an export job, and captures Chrome evidence under `var/m5-browser-evidence/`. The latest capture showed `PASSED`, 10 acceptance steps, 2 scoped orders, goods `156.00`, freight `8.00`, total `164.00`, one visible READY export row, DEV-505 stale export recovery plus failed export retry, and R05 mismatch evidence for balance-ledger plus credit-used checks.

R04 export reliability now has the first DEV-505 slices: the worker scans both fresh `QUEUED` jobs and `PROCESSING` jobs older than a 10-minute lease, reclaims them with an atomic status/age condition, clears stale error text on retry, and marks expired `PROCESSING` jobs as `FAILED`. `GET /exports/health` exposes admin/HQ-only status counts, stale processing jobs, and recent failures for W13. `POST /exports/{id}/retry` lets the owner retry an unexpired FAILED export in its saved permission scope and rejects non-failed jobs with 409. This avoids a service crash or interrupted worker leaving an export permanently stuck while keeping the existing no-migration schema.

`apps/web/ops.html` now provides the W13 operations/reconciliation view. It logs in with an authorized company account, renders `GET /exports/health` as a DEV-505导出任务健康卡片, and renders `GET /reconciliation-issues` as a read-only exception list. `npm run m5:capture-ops-evidence` captures Chrome evidence under `var/m5-browser-evidence/ops-reconciliation.png`; the latest local screenshot showed 5 current local reconciliation issues and 0 export health exception rows after the clean acceptance seed.

DEV-503 now has I08 in-app notification list/read plus three real business triggers. `Notification` persists recipient, channel, status, title/body, payload, read timestamp, and a per-recipient event key; `GET /notifications` returns the current user's latest 50 messages with unread count, and `POST /notifications/{id}/read` marks only the current user's message as read. `notifications:seed-acceptance` seeds admin/store messages, `notifications:check-acceptance` verifies list/read/isolation over HTTP, and W13 renders a "站内消息" card. Supplier shipment creation writes a "待收货提醒" notification to active users scoped to the destination store; receipt with missing quantity writes a "收货差异待处理" notification to active users scoped to the supplier; supplier discrepancy resolution writes a store notification such as "差异已同意少收". `main-flow:check-demo` verifies all three messages through real `PXFLOW` order, shipment, receipt, and F05 resolution steps.

DEV-504 now has the first audit log slice. `AuditLog` persists actor, active roles/scope, action, entity, traceId, reason, before/after JSON, and createdAt. `GET /audit-logs` is restricted to ADMIN/HQ_FINANCE and returns the latest 50 entries with actor display text. The supplier shipment, store receipt, and discrepancy resolution command paths write audit rows only after the command succeeds, so idempotent replay does not duplicate the audit trail. W13 renders a "审计日志" table, and `main-flow:check-demo` verifies all three actions are queryable.

The main-flow acceptance runner now writes a browser-readable result to `apps/web/main-flow-run.json`, and `apps/web/main-flow.html` renders the latest order-to-payment handoff status. `npm run web:check` now guards this page as well, so the main flow is visible even before a full interactive order-entry workbench is built.

W09/S05/S08 now has a repeatable local acceptance seed and checker: `npm run billing:seed-acceptance` creates `PXACC` demo data for company-term, stored-value, credit-backed, and direct supplier-term statements, plus a shared pending supplier payable reservation visible from supplier total and supplier-store views; it also seeds W10 positive/negative supplier adjustments for offset. `npm run billing:check-acceptance` verifies those facts through a temporary API and creates/confirms one W10 offset disposal. See `docs/billing-acceptance-seed.md` for accounts and checks.

`npm run acceptance:m4-browserless` now collects the strongest non-browser M4 checks into one command: build, W09/W10 seeded HTTP acceptance, DEV-402/403/406 gate-status check, generated manual-checklist sync check, main-flow acceptance output, and Web workbench visibility.

`npm run m4:gate-status` reads the generated billing acceptance output and asserts that DEV-402, DEV-403, and DEV-406 have complete automatic evidence coverage. The command is part of `acceptance:m4-browserless` and prints the remaining manual browser evidence for each gate.

`apps/web/m4-gates.json` is now the single source of truth for DEV-402/403/406 gate definitions. Both `m4-acceptance.html` and `m4:gate-status` read it, so the page, command output, and acceptance summary stay aligned.

The same gate definition file now includes manual execution steps for each gate. `m4-acceptance.html` renders those steps as an acceptance path with account, entry page, action, and expected result for DEV-402, DEV-403, and DEV-406.

`npm run m4:write-manual-checklist` generates `docs/m4-manual-acceptance.md` from the same gate definition file, giving reviewers a committed manual checklist for screenshot and recording collection.

`npm run m4:check-manual-checklist` verifies that generated checklist is still in sync with `apps/web/m4-gates.json`.

`npm run m4:check-browser-runtime` checks whether a local Chromium, Chrome, or Firefox runtime is available for manual M4 acceptance. The current environment reports Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, so the remaining M4 work is evidence collection rather than browser installation.

`npm run m4:prepare-manual-acceptance` is the single preflight command for manual M4 review. It prints the M4 status snapshot, runs the browser runtime check, database reachability check, gate-status check, manual checklist sync check, and prints the exact service commands, URLs, accounts, and DEV-402/403/406 manual acceptance path.

`npm run m4:start-manual-acceptance` starts the API and Web static server together and opens the M4 review pages in Chrome on macOS. Use it after `npm run acceptance:m4-browserless` when collecting the remaining screenshots or recordings.

`npm run m4:capture-browser-evidence` captures Chrome-rendered entry screenshots for `m4-acceptance.html`, `billing.html`, and `main-flow-demo.html` into `var/m4-browser-evidence/`. These entry screenshots support review, but DEV-402/403/406 still need manual workflow screenshots or recordings before closure.

`npm run db:check` verifies the local PostgreSQL endpoint before DB-backed M4 acceptance commands run. Docker Desktop is running in the current session, and `127.0.0.1:55438` is reachable.

`npm run m4:status` gives the fastest current M4 snapshot: browser runtime, local database, automatic gate evidence, manual checklist, browser entry screenshots, and manual evidence package status. It is meant for orientation and does not replace `acceptance:m4-browserless`.

Latest M4 browserless run passed after Docker/PostgreSQL was restored: build, W09/W10 acceptance seed/check, DEV-402/403/406 automatic gate status, manual checklist sync, main-flow demo check, main-flow acceptance runner, and Web workbench visibility all passed. API readiness and the M4 acceptance, billing, and main-flow demo pages returned HTTP 200.

`npm run m4:manual-evidence-status` lists the DEV-402/403/406 manual screenshots or recordings under `var/m4-manual-evidence/`. `npm run m4:check-manual-evidence` is the strict close-gate version and now passes with 6/6 files present.

`npm run m4:capture-manual-evidence` uses a real Chrome session to log in as `pxacc_admin` and capture the six DEV-402/403/406 browser evidence screenshots. `npm run acceptance:m4-close` then runs the full M4 browserless chain plus the strict manual evidence package check.

`apps/web/m4-acceptance.html` now renders the generated `billing-acceptance-run.json` and `main-flow-run.json` together, so a reviewer can see the latest M4 browserless acceptance result from the Web workbench rather than reading terminal logs only.

The same M4 acceptance page now includes a gate walkthrough for DEV-402, DEV-403, and DEV-406, plus the seeded account matrix for W09/S05/S08 and W10. `billing:check-acceptance` writes structured `gateId/evidenceId` entries, so the page can show which automatic evidence is already covered per gate and which manual browser evidence remains. This keeps the remaining work visible as browser acceptance and manual evidence collection, not new M5 scope.

The gate cards also provide a local manual-evidence checklist. Reviewers can mark browser screenshots or recordings as collected for DEV-402/403/406 in the page, while the authoritative local close check is `acceptance:m4-close`.

The M4 acceptance page now also renders a copyable acceptance summary. It combines the generated automatic evidence, local manual checklist state, and remaining manual evidence so the current M4 closure status can be handed off without reading terminal output.

`apps/web/main-flow-demo.html` now provides a narrow interactive operator demo. `npm run main-flow:seed-demo` creates `PXFLOW` master data and a browser-readable seed file, then the page can call the real APIs through login, order creation, procurement confirmation, supplier shipment, store receipt, supplier statement, and payment preview. `npm run main-flow:check-demo` runs the same sequence through a temporary API and reaches `COMPANY_TO_SUPPLIER` payable preview for `90.00`.

Latest commits:

Latest functional slice in this update: DEV-504 audit logs for shipment, receipt, and discrepancy resolution.
Latest commit before this progress update: `ca3b382 Notify stores after discrepancy resolution`.

```text
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
2aaf72c Add main flow acceptance runner
62a3df0 Add main flow acceptance map
ce1860e Add M4 exit checklist
5e9ecfd Add web workbench visibility check
1117d3b Add acceptance dashboard for visible progress
25288bb Record W10 workbench review
9023643 Clarify adjustment disposal states
dd39150 Record W10 commits in progress ledger
00e520a Connect W10 adjustment workbench to B12
59c7966 Add adjustment read workbench to billing page
427953d Refresh progress after adjustment payment acceptance
9b24dce Verify direct adjustment payment lifecycle
5cbc373 Verify B05 reads persisted price adjustment
146a13b Verify settled price adjustments persist separately
c0ad0de Refresh progress after clearing acceptance
16790b9 Verify clearing affects selected credit only
628d1cd Verify company term waits for store payment
dc41992 Verify shared statement item reservation
3e0f341 Cover immediate grouping across statement views
bc16c68 Verify direct payment receiver role boundaries
b856890 Assert stored value supplier payable acceptance
1bc4666 Close DEV-401 backend gates
3e7c8fd Cover price impact preview HTTP flow
173bae4 Scope purchase previews by store
6113241 Scope receipt creation by store
30ef897 Scope discrepancy resolution by supplier
a4195b2 Scope supplier order mutations
5134e59 Scope supplier order reads by supplier
1293338 Scope purchase request reads by store
942352a Harden recharge and catalog store scopes
96aee8f Allow finance scope disposal confirmation
b54145c Enforce finance store scopes
7c5cda1 Cover settlement period boundaries
54fadd1 Cover statement scope guards
4cd5090 Require statement detail scopes
b867e59 Harden statement list and detail scopes
a205d0c Record B12 receiver permission gap
ae2e702 Verify adjustment credit offsets end to end
e61f84e Allow offsets against positive adjustments
419c438 Audit M4 plan alignment and closure gates
66d8d78 Cover mixed adjustment payments
de2ced8 Gate supplier adjustments on store settlement
a674e33 Document adjustment settlement items
```

Earlier related commits:

```text
Freeze price adjustments by settlement side
818770f Fix disposal target balance by side
8837472 Net repeated price adjustments
e1140c4 Allow overpayments in difference disposal
070a1f3 Persist payment overpayments
cb076db Unify price changes in adjustment reads
8114349 Link statement totals to payment allocations
da7a0bc Make settlement state transitions atomic
3a4f1c0 Enforce payment account scopes
```

Latest committed implementation: B05 returns net price adjustments per order line, while B12 accepts both discrepancy-return and overpayment credit sources for offset or offline disposal.
The B12 target balance calculation now uses sales goods for store receivable targets and supply goods for supplier payable targets.

```text
b81a722 Serialize settlement offset reservations
e2cc71e Reserve pending offsets from payable balance
```

```text
7365e9d Add persisted report exports
ea129f6 Build initial W11 reporting screen
062e65a Enable direct supplier payments
72ea185 Verify settled statement snapshots persist
e132c1d Snapshot confirmed settlement item amounts
59ae4d3 Enforce settlement funding checks
5ea495f Guard price processing and funding checks
1c23421 Refresh M4 progress after price statement work
6c7fbb8 Test statement price adjustment links
3a6a1e3 Link price adjustments from statements
b976b3f Expose price adjustment sources
```

Confirmed payment allocations now create immutable settlement item amount snapshots in one transaction. Store, supplier total, and supplier-store statement lines and later payment previews read those snapshots, while items without a confirmed payment remain dynamic. Snapshot rows cascade with test data cleanup.

Direct supplier-term statements now use their B04 settlement item ID with the B06 payment preview/create/confirm flow and retain direct channel metadata.

Latest completed work: B12 permits a negative adjustment credit to offset a positive adjustment settlement item on the matching STORE or SUPPLIER side. Available amount subtracts reserved/confirmed payment allocations and pending/confirmed disposals. Unit and HTTP/database integration coverage verifies the offset record links both adjustment documents. Build, 28 unit tests, 26 integration tests, contract check, and diff check pass.

DEV-401 is now closed against the backend acceptance gates: AT-08 serializes revaluation with final receipt, AT-09 preserves the newer effective revision when runs are processed out of order, and the HTTP pricing flow covers P01 preview, P02 publish, P03 status/process/replay, adjustment history, and version history.

DEV-402 progress: P02 price publishing now rejects unequal sales/supply prices when the supplier is configured for direct supplier-term settlement. Setting a template supplier to direct settlement performs the same check against the template's latest prices. A database integration test covers rejection and equal-price success. This closes the identified AT-16 price guard slice; broader direct-term statement and payment acceptance remains.

DEV-403 progress: the supplier-store statement integration now sums every returned store statement and asserts goods, freight, and total amounts equal the supplier total statement. Parent linkage and shared settlement item IDs remain covered. This closes the total-versus-store-breakdown evidence slice; replenishment-period and immediate-order acceptance remain.

DEV-403 progress: fixed `IMMEDIATE` statement grouping in store, supplier-total, supplier-store, and direct statements. Same-day execution orders now include their order ID in the grouping key and statement ID, and direct statements have a regression test proving two same-day orders remain two statements.

## Plan Alignment Review (2026-09-27)

The delivery order is M0 → M1 → M2 → M3 → M4 → M5 → M6. Actual work did not follow it cleanly: R01-R04 and W11 from M5 were implemented before M4 was closed. M5 is now frozen, but those early features do not count toward closing M4.

Progress is tracked by M4 package gates rather than an unweighted percentage. DEV-401 through DEV-406 are now closed against the local M4 acceptance gates.

| Package | Current assessment against plan | Closure evidence still needed |
|---|---|---|
| DEV-401 | **Closed**: P01-P03, AT-08, AT-09, and W06/S10 backend flow evidence are complete | None for the current backend scope |
| DEV-402 | **Closed**: B01-B04, amount/period logic, AT-16 price guard, direct-term B04→B08 flow, AT-17 credit-limit guard, AC-21 stored-value supplier payable, and W09/S05/S08 browser evidence verified | None for the current M4 package |
| DEV-403 | **Closed**: statement read paths, total/store sum, immediate per-order grouping across all four views, replenishment period, account scope, cross-view shared-item reservation, and W09/S05/S08 browser evidence verified | None for the current M4 package |
| DEV-404 | **Closed**: B06-B11 payment lifecycle, AT-13 concurrency, receiver authorization, direct-term adjustment payment, company-term store-first HTTP gate, mandatory I06/I07 PAYMENT evidence, participant download scope, expired-upload cleanup, and local DB/private-file restore evidence verified | Production storage/backup operations remain M6 |
| DEV-405 | **Closed**: A04-A06, store scope, and W08 selected-only clearing/accounting flow verified | None for the current M4 package; production backup policy remains DEV-603/M6 |
| DEV-406 | **Closed**: persisted adjustments, repeated-change netting (+20 then +10), positive adjustment payment, offsets/returns, receiver scopes, snapshot reconciliation, W10 workbench, B05→B12 real-database HTTP flow, and W10 browser evidence verified | None for the current M4 package |

W09 first usable web flow is now implemented in `apps/web/billing.html`: role-filtered store, supplier total, supplier-store, and direct statements; detail lines; payment preview/registration with private evidence upload; payment list; receiver confirmation; and counterparty-scoped evidence download. Existing API and browser script checks pass. The same page now has narrow-screen S05/S08 layout rules; broader end-to-end browser acceptance remains open.

W09 detail now exposes each persisted positive adjustment settlement item and amount, so the payment picker can register adjustment payments alongside order lines. Statement services normalize adjustment amounts through Decimal for both database values and test/integration projections.

I07 authorization now has HTTP evidence that a supplier linked to a payment can download its payment proof, while the route remains restricted to payment participants or authorized finance roles.
The same acceptance now verifies an unrelated supplier receives 404 for that proof.

The M4 package sequence is locally closed. DEV-404 and DEV-405 are closed against their M4 package conditions; local recovery evidence is recorded, while production backup policy remains in DEV-603/M6. Revisit M5 after preserving the generated M4 evidence package and rerunning `npm run acceptance:m4-close` if any M4-related code changes.

DEV-406 payment previews subtract PENDING and CONFIRMED difference offsets from payable availability. Payment and offset creation use the same PostgreSQL transaction advisory locks for settlement item IDs; credit IDs are locked before duplicate-disposal checks. Payment and adjustment/disposal reads enforce store/supplier scopes, and state changes use conditional version/status updates. B01-B04 aggregate RESERVED and CONFIRMED allocations. AT-14 offline return, receiver scope, repeated price-change netting, frozen snapshot reconciliation, and W10 browser evidence are covered.

DEV-405 clearing creation now conditionally updates each funding allocation by version, active state, and outstanding amount, and conditionally updates the store account version and credit used. A concurrent second clearing therefore fails atomically instead of consuming the same credit twice.

## Progress Metrics

The earlier 70%–75% backend and 40%–45% release figures were estimates without a repeatable acceptance-item denominator, so they are retired. Trackable M4 status currently is **6 closed, 0 partial, 0 not started**. This whole-package count is a gate status, not a sensitive progress metric; use the closure-evidence column in the plan alignment review to show movement between commits. Do not publish an overall percentage until the plan has an itemized denominator for all milestones.

## Verification Baseline

The latest completed stage passed:

```bash
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration && npm run contract:check
```

Current integration coverage count: 28 integration tests passing; unit coverage is 35 tests.

Latest run: 30 integration tests and 36 unit tests passed, along with build, contract check, and diff check.

DEV-404 acceptance slice: payment integration now registers the same supplier payable concurrently with two different idempotency keys and verifies exactly one reservation succeeds while the other conflicts; replaying the winning key returns the original payment. B07 requires at least one completed PAYMENT evidence file belonging to the registering actor, and missing evidence is rejected before command creation. Existing payment HTTP flows upload and link real test PDFs. Latest verification: 36 unit tests, 31 integration tests, build, contract check, and diff check passed.

DEV-405 acceptance slice: clearing preview/create/detail integration covers the selected credit allocation, independent clearing document, account ledger, released credit, and idempotent replay; clearing detail, account, and ledger reads now reject a mismatched store scope for both STORE and STORE_FINANCE.

DEV-406 acceptance slice: the integration now creates a negative adjustment with no follow-up order, disposes it through `OFFLINE_RETURN` without a target debit, and confirms it through the receiver role; AT-14 is covered end to end.

DEV-401 concurrency slice: price-run processing now locks each supplier order before reading completion status, so a receipt that commits first is skipped and a revaluation that acquires the lock first is applied before completion.

DEV-402/403 evidence slice: direct-term settlement previews resolve to `STORE_TO_SUPPLIER` with the DIRECT channel and include freight; replenishment shipments remain in the supplier order's first-shipment half-month period.

DEV-406 scope hardening: adjustment list/detail and difference-disposal detail/confirmation now enforce the authenticated store or supplier scope before returning or mutating records. Company roles retain the existing company access paths.
Statement and payment scope hardening: STORE and STORE_FINANCE accounts now share the same bound-store enforcement across statements, payments, adjustments, difference disposals, and clearing details; unconfigured accounts are rejected before decoded IDs are queried.
Controller regression coverage now verifies statement list narrowing and missing detail scopes for STORE, STORE_FINANCE, and SUPPLIER paths.
DEV-403 AT-10 coverage now checks half-month 15/16 boundaries, Sunday/Monday weekly boundaries, year-end rollover, and leap-day month length.

Current verified change: price-change runs now report FAILED when any child order fails; P02 revaluation refreshes purchase-request funding summaries; purchase confirmation recalculates funding from current item amounts and current account balance before splitting. Payment preview blocks unresolved positive shortfalls and company-term supplier payments whose store receivables are not confirmed paid. Price changes do not mutate balances or ledgers.

Latest verification: recharge detail and store catalog scope hardening passed build, 35 unit tests, 28 integration tests, contract check, and diff check.

Purchase request scope hardening passed the same verification baseline.

Supplier order F01 scope hardening passed the same verification baseline.

Supplier order mutation scope hardening passed the same verification baseline.

F04 discrepancy scope hardening passed the same verification baseline.

F04 receipt scope hardening passed the same verification baseline.

O01/O02 store scope hardening passed the same verification baseline.

DEV-501 R01-R03 backend slice is implemented. `completedAt` is persisted and written when fulfillment becomes complete; existing completed orders are backfilled by migration. R01 reports completed-order amounts by completion month, R02 final received quantities by completion date with a three-month limit, and R03 completed non-direct order profit by first shipment date with freight separate. Date filtering uses Asia/Shanghai day boundaries; completed order prices are frozen by P02's completed-order exclusion. Local migration, build, 10 unit tests, 26 integration tests, contract check, and diff check passed.

Report access now accepts store and supplier roles for R01/R02 and forces their bound `UserScope` into the query. R03 remains company-only. I05 `PATCH /users/{id}` can assign one COMPANY, STORE, or SUPPLIER scope; the scope is included in login authentication context. The scope migration is deployed locally.

W11 first usable web screen is implemented in `apps/web`: login, R01-R03 tabs, date/entity filters, KPI summaries, result tables, empty/error states, and CSV export. Start with `npm run start:web`; API CORS permits the local web origin.

R04 creates a persisted export job (202), claims queued CSV jobs atomically with PROCESSING status, exposes status and owner-only download routes, rechecks the current report role and bound account scope, and expires snapshots after seven days. The API polls queued jobs after restart and cleans expired content; storage is database text rather than private object storage.

Statement and adjustment period grouping now uses the supplier order's settlement cycle snapshot, so changing supplier defaults does not move historical orders.

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
- M4 settlement and reconciliation are locally closed against the current package gates. DEV-402/403/406 have automatic evidence and browser screenshot evidence.
- W09 billing and W10 adjustment pages are implemented for the recorded flows; Chrome-based evidence capture now covers the M4 browser acceptance package.

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
- Exposes P02 `PriceChangeAdjustment` records through the same endpoint as separate store receivable and supplier payable adjustment rows, including unfinished orders whose baseline is request submission time.
- Calculates adjustment amount from returned quantity times source supplier order item supply unit price.
- Returns original supplier statement ID and original period based on the source order first shipped time.
- Returns actual adjustment period based on the return record creation time.
- Supports filtering by storeId, supplierId, cycle, actual period, and processingStatus.
- Marks adjustments DISPOSED when linked to a confirmed `DifferenceDisposal`, otherwise PENDING_DISPOSAL.
- Direct settlement adjustments and persisted adjustment documents remain future work.

Current B06 behavior:

- Statement detail lines expose stable virtual `settlementItemId` values.
- Store statement lines preview as `STORE_TO_COMPANY` payment items using sales amount plus shipment freight.
- Supplier total and supplier-store statement lines share supplier payable IDs and preview as `COMPANY_TO_SUPPLIER` items using supply amount plus shipment freight.
- Validates selected items are completed, share the same payment direction, and belong to the same paying/receiving subject.
- Returns payable amount, pending amount, confirmed paid amount, source version, and blocked items.
- Includes existing RESERVED allocations as pending amounts.
- Blocks positive unresolved purchase funding shortfalls and, for COMPANY_TERM supplier payable items, requires the related store receivable to be fully confirmed paid.

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
- If the payable amount decreases after registration but before confirmation, B08 preserves the registered payment and persists the excess as an `Overpayment`; the response exposes its amount and source rows.
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
- Revaluation refreshes the affected purchase request's funding summary against current store balance in the same transaction; positive shortfalls therefore block payment preview.
- The database integration test covers a real affected execution order, updated line totals, and persisted price adjustment source; repeated run processing returns 409.
- `GET /jobs/{id}` returns each processed order's adjustment ID and before/after sales and supply prices.
- `GET /jobs/{id}/adjustments` returns the persisted per-order adjustment source rows for later statement and payment reconciliation.
- Store, supplier total, supplier store, and direct statement detail lines include associated processed price adjustment IDs and deltas; statement amounts use current order totals once.
- P01 previews the uncompleted orders in the price version's effective interval and returns estimated sales and supply deltas; completed orders are excluded.
- Publishing remains synchronous; a separate worker queue and automatic asynchronous run pickup remain future work.

## Recommended Next Step

W10 implementation and its real-database B05→B12 HTTP flow are complete, and M4 local close acceptance now passes. Next follow the plan order by resuming M5 reporting/export or the next approved milestone.

For a user-visible status map, use `docs/acceptance-dashboard.md`. It maps each implemented slice back to the original plan, shows the available workbenches, and separates passed API evidence from still-open browser E2E.

For the M4 exit gates, use `docs/m4-exit-checklist.md` together with `npm run acceptance:m4-close`. DEV-402, DEV-403, and DEV-406 now meet the local close conditions.

The ordering-to-payment main flow is tracked in `docs/main-flow-acceptance.md`. Current assessment: backend APIs and integration tests cover the main path, but the visible product flow starts mostly at billing/payment. The next execution step should create a narrow visible main-flow demo or scripted acceptance runner before adding more detailed settlement work.

`npm run acceptance:main-flow` now provides that scripted runner. It starts a temporary API instance, seeds isolated data, runs purchase request creation, procurement confirmation, supplier shipment, store receipt, statement reads, and supplier payment preview, then cleans up. Latest local run passed and printed the expected 120.00 store statement and 90.00 supplier payable preview.

## Where To Look

- Visible acceptance map: `docs/acceptance-dashboard.md`
- Main flow acceptance map: `docs/main-flow-acceptance.md`
- M4 exit checklist: `docs/m4-exit-checklist.md`
- Completed chronological notes: `docs/development-log.md`
- Planned milestones: `docs/development-plan.md`
- API contract: `docs/api-design.md`
- Static contract checks: `scripts/check-contract.mjs`
- Current order-flow integration coverage: `tests/integration/purchase-preview-http.test.ts`

Private evidence storage slice: I06 creates a payment-evidence upload session; I07 accepts JPEG/PNG/PDF files up to 10 MiB, checks file signatures and SHA-256, stores bytes under mode-0700 `PRIVATE_FILE_DIR`, and permits authorized participant/finance downloads. B07 requires at least one READY PAYMENT file ID owned by the registering actor and links it to the payment. HTTP upload/complete/download, missing-evidence rejection, and expiry cleanup are covered. Local database and private-file restore were demonstrated; production storage/backup operations remain M6.
