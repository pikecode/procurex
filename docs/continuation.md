# ProcureX Continuation Handoff

Last updated: 2026-09-27

Use this as the first document when continuing development in a new window.

## Current State

The project is still in M4. DEV-401, DEV-404, and DEV-405 are closed against current backend gates. DEV-402, DEV-403, and DEV-406 remain partial because their final browser-level screenshots or recordings have not been collected yet. `npm run m4:status` is the fastest current snapshot: Chrome is ready, automatic evidence/checklists/screenshots are ready, and the local PostgreSQL endpoint is blocked until Docker Desktop or another PostgreSQL instance is started.

The direction has not shifted: finish M4 settlement/billing/payment/adjustment acceptance before reopening M5 reporting or operations scope.

## Latest High-Signal Work

Recent commits added visible and repeatable acceptance evidence:

```text
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
```

`m4-acceptance.html` is the best first screen for review: it shows the latest browserless result, the DEV-402/403/406 gate status, structured automatic evidence coverage, the seeded account matrix, a copyable acceptance summary, and the manual evidence still needed for M4 closure. The manual evidence checkboxes are saved locally in the browser and are review aids, not backend acceptance data.

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

For the M4 gate status summary, run:

```bash
npm run m4:prepare-manual-acceptance
npm run m4:status
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

## Remaining Work

Do these in order:

1. Run real browser/manual acceptance for DEV-402 settlement modes once a browser runtime is available.
2. Run real browser/manual acceptance for DEV-403 statement-family switching and shared settlement item reservation.
3. Run real browser/manual acceptance for DEV-406 W10 adjustment list/detail/offline-return/offset/confirmation.
4. Only after M4 is closed, decide whether to build the interactive main-flow operator workbench or resume M5.

Do not add new M5 scope until M4 is accepted.
