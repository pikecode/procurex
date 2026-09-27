# ProcureX Continuation Handoff

Last updated: 2026-09-27

Use this as the first document when continuing development in a new window.

## Current State

M4 is locally closed against the current acceptance gates. DEV-401 through DEV-406 are closed, `npm run acceptance:m4-close` passes, Chrome is ready, local PostgreSQL is reachable, automatic evidence is complete, and the manual browser evidence package is 6/6.

The direction has not shifted: M4 settlement/billing/payment/adjustment acceptance is now closed locally, so the next planned work can move back to M5 reporting or the next approved milestone.

## Latest High-Signal Work

Recent commits closed the visible and repeatable M4 acceptance evidence:

```text
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

1. Preserve the generated M4 evidence package under `var/m4-manual-evidence/` when handing off local evidence.
2. Run `npm run acceptance:m4-close` after any billing or acceptance change.
3. Resume M5 reporting/export or the next approved milestone.

Do not reopen M4 unless a regression appears in `acceptance:m4-close` or a reviewer rejects the collected browser evidence.
