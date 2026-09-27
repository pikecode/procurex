# Billing Acceptance Seed

Last updated: 2026-09-27

This local seed creates visible W09/S05/S08 billing data for manual acceptance while browser automation remains blocked.

Run after database setup:

```bash
npm run build
npm run billing:seed-acceptance
npm run billing:check-acceptance
npm run start:api
npm run start:web
```

Open `http://127.0.0.1:4173/billing.html`.

## Accounts

All accounts use password `correct-password`.

| Account | Role Scope | Use |
|---|---|---|
| `pxacc_admin` | ADMIN, HQ_FINANCE | View all statement tabs and payment records. |
| `pxacc_store` | STORE, STORE_FINANCE scoped to PX Acceptance Store | View store statements and direct statements from a store/mobile-like scope. |
| `pxacc_supplier_company` | SUPPLIER scoped to company-term supplier | View supplier-side company-term statements. |
| `pxacc_supplier_direct` | SUPPLIER scoped to direct supplier | View direct supplier-term statements. |

## Seeded Evidence

| Evidence | What To Check |
|---|---|
| `PXACC-SO-COMPANY` | Company-term supplier payable exists, but supplier payment preview is blocked until the store receivable is settled. |
| `PXACC-SO-STORED` | Stored-value order still appears in supplier payable statements; a pending shared payment reservation is visible from supplier total and supplier-store views. |
| `PXACC-SO-CREDIT` | Credit-backed order appears with a half-month period starting `2026-09-16`. |
| `PXACC-SO-DIRECT` | Direct statement preview shows `STORE_TO_SUPPLIER` and channel `DIRECT`. |
| `PXACC-SO-STORED-ADJ-CREDIT` | Negative supplier adjustment exposes a B12 credit item for disposal. |
| `PXACC-SO-STORED-ADJ-TARGET` | Positive supplier adjustment exposes a target settlement item for offset. |

The script is repeatable. It deletes prior `PXACC` seed data before inserting the current acceptance dataset.

`npm run billing:check-acceptance` starts a temporary local API and verifies the seeded W09/S05/S08 evidence through real HTTP requests. It also creates and confirms one W10 offset disposal from the negative supplier adjustment to the positive supplier adjustment.

After `npm run acceptance:m4-browserless`, open `apps/web/m4-acceptance.html` through the static web server to review the latest M4 and main-flow acceptance output in one place.
