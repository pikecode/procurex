# ProcureX Continuation Handoff

Last updated: 2026-09-27

Use this as the first document when continuing development in a new window.

## Current State

The project is still in M4. DEV-401, DEV-404, and DEV-405 are closed against current backend gates. DEV-402, DEV-403, and DEV-406 remain partial because final browser-level acceptance is blocked by the missing browser runtime.

The direction has not shifted: finish M4 settlement/billing/payment/adjustment acceptance before reopening M5 reporting or operations scope.

## Latest High-Signal Work

Recent commits added visible and repeatable acceptance evidence:

```text
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

Run the strongest browserless M4 chain:

```bash
npm run acceptance:m4-browserless
```

This performs:

1. TypeScript build.
2. W09/W10 `PXACC` acceptance seeding.
3. W09/S05/S08 and W10 HTTP acceptance checks.
4. Main-flow acceptance runner.
5. Interactive main-flow demo seeding and HTTP check.
6. Web workbench visibility check.

Generated local files:

```text
apps/web/billing-acceptance-run.json
apps/web/main-flow-run.json
```

These files are intentionally ignored by git.

## What To Open

Start the local services:

```bash
npm run start:api
npm run start:web
```

Open:

```text
http://127.0.0.1:4173/m4-acceptance.html
http://127.0.0.1:4173/main-flow-demo.html
http://127.0.0.1:4173/billing.html
http://127.0.0.1:4173/main-flow.html
```

`m4-acceptance.html` is the best first screen for review: it shows the latest browserless result, the DEV-402/403/406 gate status, structured automatic evidence coverage, the seeded account matrix, and the manual evidence still needed for M4 closure.

If port `4173` is occupied, run a one-off static server on another port:

```bash
python3 -m http.server 4174 --directory apps/web
```

## Seeded Accounts

All seeded accounts use password `correct-password`.

| Account | Use |
|---|---|
| `pxflow_user` | Interactive main-flow demo from order creation to payment preview. |
| `pxacc_admin` | ADMIN/HQ finance view for all billing tabs and checks. |
| `pxacc_store` | Store-scoped billing and direct statement view. |
| `pxacc_supplier_company` | Supplier-scoped company-term view. |
| `pxacc_supplier_direct` | Supplier-scoped direct-term view. |

More detail is in `docs/billing-acceptance-seed.md`.

For the interactive main-flow demo, run:

```bash
npm run main-flow:seed-demo
npm run main-flow:check-demo
```

## Remaining Work

Do these in order:

1. Run real browser/manual acceptance for DEV-402 settlement modes once a browser runtime is available.
2. Run real browser/manual acceptance for DEV-403 statement-family switching and shared settlement item reservation.
3. Run real browser/manual acceptance for DEV-406 W10 adjustment list/detail/offline-return/offset/confirmation.
4. Only after M4 is closed, decide whether to build the interactive main-flow operator workbench or resume M5.

Do not add new M5 scope until M4 is accepted.
