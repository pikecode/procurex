# Requirement Surface Audit

Last updated: 2026-09-30

This audit separates the original delivery surfaces instead of treating one client as a substitute for another.

## Direction Check

The current work is still aligned with `docs/development-plan.md`: M4 is locally closed, M5 reporting/operations is locally gated, M6 production launch is intentionally not ready until external evidence exists, and M7 is productizing the already-real flows into usable Web and mini-program surfaces.

The latest audit found one locally actionable gap in DEV-501: W11 Web reports were covered, but "mini-program per-role statistics" was not visible in the native mini-program pages. That gap is now closed locally: Store and Supplier mini-program pages show scoped order amount and product quantity statistics, Purchaser shows order amount, product quantity, and authorized profit statistics, and the real API mini-program flow verifies the report endpoints and the Supplier profit denial.

## Surface Matrix

| Area | Formal Web App | Native Mini-Program | Evidence | Remaining Gap |
|---|---|---|---|---|
| Store order and receipt | `app.html#/store`, `app.html#/flow` | `pages/store/index` | Browser interactive flow, `mini:flow-check` | WeChat Developer Tools / real device |
| Purchaser confirmation and rejection reallocation | `app.html#/purchaser`, `app.html#/flow` | `pages/purchaser/index` | Browser reallocation evidence, `mini:flow-check` | WeChat Developer Tools / real device |
| Supplier shipment, rejection, discrepancy, payment confirmation | `app.html#/supplier`, `app.html#/flow` | `pages/supplier/index` | Browser supplier actions, `mini:flow-check` | WeChat Developer Tools / real device |
| Finance payment registration and settlement detail | `app.html#/finance` | Supplier mini-program payment confirmation only | Browser finance confirm/reject evidence | Customer finance sign-off and production evidence |
| Reporting and statistics DEV-501 | W11 report page plus App evidence | Store/Supplier scoped R01/R02, Purchaser R01/R02/R03 | `mini:check`, `mini:flow-check`, M5 reports acceptance | Real-device display and customer acceptance |
| Notifications, audit, export, reconciliation | W13 and backend gates | Notification-driven Store/Supplier/Purchaser actions | M5 gates, mini API flow | Production monitoring and customer pilot |

## Latest Local Evidence

- `npm run mini:check` verifies native pages, statistics panels, report API paths, role boundaries, and no HTML under `apps/miniprogram`.
- `npm run mini:flow-check` rebuilds, reseeds PXFLOW, starts the API, and verifies Store/Supplier/Purchaser flows plus `GET /reports/order-amounts`, `GET /reports/product-quantities`, `GET /reports/profit`, and Supplier profit 403.
- `npm test` passes 47 unit tests after the report scope fix.
- `npm run web:check` passes after the mini-program statistics update.

## External Gates

Do not mark production launch ready until these are provided and checked: production server/domain/runtime configuration, signed storage policy, WeChat Developer Tools and real-device evidence, customer finance sign-off, customer pilot run, and handover evidence.

## Next Local Work

Continue with broad requirement closure rather than narrow page polish: refresh the local M6 evidence package after this mini-program statistics change, then run the stronger acceptance baselines. Any new work should reduce one of the remaining mapped gaps above.
