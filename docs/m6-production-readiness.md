# M6 Production Readiness

Last updated: 2026-09-28

This document is the M6 handoff ledger. It separates locally proven product evidence from production-only evidence that cannot be faked with local mocks.

## Current Status

M4 and M5 local gates are strong enough to start production-readiness work. They do not mean the system is ready to launch in production.

Use:

```bash
npm run m6:readiness
npm run m6:performance
npm run m6:rollback-check
```

The command writes `apps/web/m6-readiness.json`, which is rendered by `apps/web/m6-readiness.html`.

Use the strict gate only when real production materials exist:

```bash
npm run m6:readiness:strict
```

## Evidence Policy

`READY` means the evidence can support launch review.

`LOCAL_READY` means local implementation evidence exists, but production evidence is still required.

`BLOCKED` means an external account, production service, configuration, or real-device artifact is missing.

`PLANNED` means the activity has a known checklist but no executed evidence yet.

## Required M6 Evidence

| Area | Required Evidence | Current Expected Status |
|---|---|---|
| DEV-601 full regression | Latest `acceptance:m5-close`, M5 gate, desktop/mobile main-flow and role-workbench evidence | READY when current local evidence is fresh |
| DEV-602 performance | Reproducible dataset size, environment, p50/p95/error rate, report query timing, export generation timing from `m6:performance` | LOCAL_READY when `var/m6-performance-report.json` is fresh; still needs production-scale evidence |
| DEV-602 browser/device | Desktop and 390px Web evidence plus broader production-device review | LOCAL_READY |
| DEV-602 mini-program product flow | Native mini-program login plus Store, Supplier, and Purchaser product pages checked by `mini:check`; local role API flow checked by `mini:flow-check` and `apps/miniprogram/mini-flow-check.json` | LOCAL_READY when both checks are fresh |
| DEV-602 WeChat | Real AppID, test account, binding mode, upload behavior, subscription-message behavior, real-device screenshots or recording | BLOCKED until external materials exist |
| DEV-603 deployment | Production `DATABASE_URL`, private file/object storage target, public API base URL, TLS/domain routing, worker process plan | BLOCKED until production environment exists |
| DEV-603 backup/recovery | Production backup schedule, private evidence-file backup, measured RPO <= 15 minutes, measured RTO <= 4 hours | LOCAL_READY for local drill only |
| DEV-603 rollback | Migration command owner, one-instance migration rule, rollback package, failed-release decision point, and `m6:rollback-check` evidence | LOCAL_READY when local rollback check passes; production rehearsal still required |
| DEV-604 initialization | Cutoff date, master data, opening balances, uncleared receivables/payables, role bindings, finance sign-off | PLANNED |
| DEV-605 pilot | Selected stores/suppliers, recharge/clearing, cross-period replenishment, full statement cycle, issue closure, handover | PLANNED |

## External Inputs Needed

| Input | Needed For | Latest Stage |
|---|---|---|
| WeChat subject, AppID, test accounts, binding operation mode | Mini-program login, upload, and subscription-message validation | Before external integration |
| Production database, object storage/private file service, budget | Deployment, backup, and recovery target | Before production environment build |
| Domain, TLS termination, public API base URL | Browser/mini-program production routing | Before launch rehearsal |
| Reminder thresholds and channel authorization | Notification operations | Before pilot |
| Cutoff date, balances, uncleared payables/receivables, migration source files | Initialization and finance reconciliation | Before data switch |
| Monitoring receiver and escalation owner | Operations handover | Before pilot |

## Release And Rollback Runbook

Release owner: one named operator owns the production release window and is the only person allowed to run `npm run db:migrate`.

one-instance migration rule: migrations are applied once, from one controlled shell, after the target commit and release package are tagged. No API/worker instance should auto-run migrations on boot.

rollback package: every release candidate must preserve the previous application build identifier, the target build identifier, the migration status output, the pre-release database backup reference, the private-file backup reference, and the generated `apps/web/m6-readiness.json`.

failed-release decision point: if API health, migration status, login, order creation, receipt creation, or payment confirmation fails during smoke validation, freeze traffic, stop the worker, keep the current database intact, redeploy the previous application build, and only restore database/private files after release owner and finance owner approve the data rewind impact.

Local check:

```bash
npm run m6:rollback-check
```

The local check is non-destructive. It validates Prisma schema/migration status, required package scripts, migration artifacts, and this runbook text, then writes `var/m6-rollback-drill.json`.

## Next Work

1. Keep `npm run acceptance:m5-close`, `npm run mini:check`, and `npm run mini:flow-check` green while adding M6 checks.
2. Collect real WeChat and production environment inputs.
3. Keep `npm run m6:performance` fresh locally, then replace or supplement it with production-scale load evidence before launch review.
4. Produce `var/m6-initialization-signoff.json` after finance checks opening balances.
5. Produce `var/m6-pilot-run.json` after a real pilot cycle.

Do not mark M6 closed from local Web evidence alone.
