# ProcureX Acceptance Dashboard

Last updated: 2026-09-27

This file is the visible checkpoint for product direction. It maps implemented work back to the plan, shows what can be tried locally, and lists the remaining acceptance gaps. Use it with `docs/progress.md` before starting new work.

For the exact M4 closure checklist, use `docs/m4-exit-checklist.md`.

For the end-to-end ordering-to-payment flow, use `docs/main-flow-acceptance.md`. It separates backend evidence from what is actually visible to a user.

## Direction Check

The current direction is aligned with the confirmed plan: close M4 settlement, billing, payment, clearing, and adjustment acceptance before reopening M5 reporting/operations.

There was one recorded deviation: R01-R04 and W11 reporting/export work started before M4 was fully accepted. That scope is now frozen. New work should stay on M4 until DEV-402, DEV-403, and DEV-406 are closed.

## Current Gate Status

| Package | Status | Why |
|---|---|---|
| DEV-401 historical repricing | Closed | P01-P03, run processing, completed-order exclusion, and concurrency/order tests are covered. |
| DEV-402 amount and period logic | Partial | B01-B04 and key period/settlement rules are implemented; final W09/S05/S08 acceptance for settlement modes remains. |
| DEV-403 statement families | Partial | Store, supplier total, supplier-store, and direct statements exist with shared settlement IDs; browser-level W09/S05/S08 acceptance remains. |
| DEV-404 payment lifecycle | Closed | B06-B11, evidence files, receiver authorization, direct/company payment gates, and concurrency are covered. |
| DEV-405 clearing | Closed | A04-A06 selected-credit clearing, ledger/account updates, scope checks, and local restore evidence are covered. |
| DEV-406 adjustments and difference disposal | Partial | B05/B12, persisted adjustments, returns, offsets, overpayments, and W10 workbench exist; browser-level W10 acceptance remains. |

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
| W09/S05/S08 billing | `apps/web/billing.html` | Four statement families, statement detail, payment preview, payment registration with evidence upload, receiver confirmation, payment list, evidence download. | Implemented; HTTP/static smoke passed; browser E2E blocked by missing browser runtime. |
| W10 adjustments | `apps/web/billing.html` adjustment views | Adjustment filtering, original vs actual period comparison, detail, B12 offline return, receiver confirmation, offset to positive adjustment. | Implemented; HTTP/database B05 to B12 flow passed; browser E2E blocked by missing browser runtime. |
| W11 reporting | `apps/web/index.html` | R01-R03 reports, filters, summaries, CSV/export flow. | Implemented early; frozen until M4 acceptance closes. |
| Main order flow | `npm run acceptance:main-flow` and `apps/web/main-flow.html` | Store order, procurement confirmation, supplier shipment, store receipt, statement read, supplier payment preview. | Scripted acceptance runner passes and writes a browser-readable result page; interactive Web/mini-program flow is still missing. |

## Requirement-To-Evidence Map

| Requirement Area | Implemented Evidence | Remaining Gap |
|---|---|---|
| Purchase order split and supplier execution | O01-O11, F01-F07 integration flows and scope hardening. | Full browser/mobile user acceptance. |
| Store receiving and discrepancy handling | Receipt revisions, ACCEPT/REPLENISH/RETURN, replenishment gaps, difference disposal links. | Browser/mobile acceptance and notification flows. |
| Stored-value and credit finance | Account, recharge, credit limit, clearing, credit-limit guard, selected-only clearing. | Production initialization and finance sign-off. |
| Four statement families | B01 store, B02 supplier total, B03 supplier-store, B04 direct statements. | Browser-level W09/S05/S08 acceptance. |
| Payment and evidence | B06-B11, private file upload/download, required PAYMENT evidence, participant authorization. | Production storage policy and deployment configuration. |
| Price change and adjustments | P01-P03, persisted adjustment documents, repeated-change netting, B05 reads, B12 returns/offsets. | Browser-level W10 acceptance and final M4 closure review. |
| Reporting/export | R01-R04 backend and initial W11 page. | Frozen until M4 closes; then complete notification/audit/recovery scope. |

## Verification Commands

The backend acceptance baseline is:

```bash
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration && npm run contract:check
```

The browserless workbench visibility check is:

```bash
npm run web:check
```

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

The latest progress ledger records successful runs with 36 unit tests and 31 integration tests for the W09/W10 slices. Always rerun the full baseline before marking a package closed.

## Browser E2E Blocker

Browser E2E has not been counted as passed. The current environment has no installed Chromium/Chrome/Firefox. A temporary Playwright Chromium download was attempted but stopped after about 9 MB of 182 MB in roughly two minutes.

Until a browser runtime is available, W09/W10 can only be verified by:

- API integration tests.
- Static HTTP smoke checks.
- JavaScript syntax checks.
- `npm run web:check`, which confirms the W09/W10 page exposes the billing, payment, evidence, adjustment, offline-return, and offset entry points, and confirms the main-flow result page can render runner output.
- Manual review of `apps/web/billing.html`, `apps/web/billing.js`, and `apps/web/billing.css`.

## Next Work Order

1. Close DEV-402 browser/manual acceptance for settlement modes.
2. Close DEV-403 browser/manual acceptance for W09/S05/S08.
3. Close DEV-406 browser/manual acceptance for W10.
4. Build an interactive main-flow operator workbench after M4 acceptance is no longer at risk.
5. Only then unfreeze M5 reporting/operations work.

Do not add new reporting, notification, or deployment scope until M4 is accepted.
