# M4 Exit Checklist

Last updated: 2026-09-27

This checklist exists because M4 is the financial closure layer. M4 should not be marked complete merely because APIs or pages exist; it closes only when the billing, payment, clearing, and adjustment flows are visibly accepted.

## Why M4 Is Still Open

M4 contains the risky money paths:

- B01-B04 statement grouping and amount calculation.
- B05 adjustments after repricing or receiving discrepancies.
- B06-B11 payment preview, registration, evidence, confirmation, rejection, and cancellation.
- B12 difference return/offset disposal.
- A04-A06 clearing selected credit without altering cumulative debt.
- W09/S05/S08 billing workbench and W10 adjustment workbench acceptance.

The backend evidence is strong, but browser-level acceptance is still blocked by the missing browser runtime. Until that is available, M4 stays open with DEV-402, DEV-403, and DEV-406 partial.

## Gate Rules

Do not reopen M5 work until all rows below are closed.

| Gate | Current State | Close When |
|---|---|---|
| DEV-402 settlement amount/period acceptance | Partial | W09/S05/S08 can show company-term, direct-term, stored-value, and credit-backed settlement amounts with correct period and payment status. |
| DEV-403 statement-family acceptance | Partial | W09/S05/S08 can switch store, supplier total, supplier-store, and direct statement views; shared settlement items cannot be paid twice. |
| DEV-406 adjustment/difference acceptance | Partial | W10 can list an adjustment, open detail, register offline return or offset, and show receiver confirmation/disposed state. |

## Browser Acceptance Steps

Prerequisites:

```bash
npm run build
npm run billing:seed-acceptance
npm run start:api
npm run start:web
```

Open:

```text
http://127.0.0.1:4173/billing.html
```

Use `docs/billing-acceptance-seed.md` for the local seeded accounts and the expected `PXACC` statement evidence.

### DEV-402

1. Log in as company finance or admin.
2. Open each available billing tab.
3. Confirm direct-term statements show `DIRECT` payment channel through preview.
4. Confirm company-term supplier payable is blocked until related store receivable is settled.
5. Confirm stored-value orders still produce supplier payable statements.
6. Confirm period labels match first shipment or the documented immediate-cycle rule.

Close evidence:

- Screenshot or screen recording of each settlement mode.
- Matching backend run of the full baseline.
- `npm run web:check` passes.

### DEV-403

1. Open store statement, supplier total statement, supplier-store statement, and direct statement views.
2. Open details for each statement family.
3. Select a supplier payable from supplier-store, preview/register payment.
4. Reopen supplier total for the same source item.
5. Confirm the shared item shows pending/paid amount and cannot be paid again.
6. Confirm same-day immediate orders remain separate statements.

Close evidence:

- Screenshot or screen recording of the four statement families.
- Evidence that shared item reservation appears from the other view.
- Backend integration baseline passes.

### DEV-406

1. Open the W10 adjustment section.
2. Filter by pending disposal.
3. Open an adjustment detail.
4. Register offline return for a negative adjustment with no target.
5. Register offset from a negative adjustment to a positive adjustment where available.
6. Log in as the receiver role and confirm the disposal.
7. Confirm the adjustment moves to disposed state and payable availability is reduced.

Close evidence:

- Screenshot or screen recording of list, detail, registration, confirmation, and disposed state.
- Targeted HTTP/database B05 to B12 flow passes.
- `npm run web:check` passes.

## Browserless Evidence Allowed Before Final Close

These checks can support development, but they do not fully close the browser gates:

```bash
npm run web:check
npm run contract:check
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration
```

Browserless evidence may prove that APIs, page entry points, and scripts exist. It does not prove that the user can complete the workflow in the browser.

## Current Blocker

No Chromium, Chrome, or Firefox executable is currently available in this environment. A previous temporary Playwright Chromium download was stopped after about 9 MB of 182 MB. Browser E2E can resume when a browser runtime is installed or made available.
