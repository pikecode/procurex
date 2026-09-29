# M6 Local Evidence Handoff

Last updated: 2026-09-29

This handoff summarizes the local M6 evidence package. It does not claim production launch readiness.

## Current Status

| Item | Value |
|---|---|
| Package status | LOCAL_READY |
| Readiness status | NOT_READY |
| Readiness counts | READY 1, LOCAL_READY 7, BLOCKED 3, PLANNED 0 |
| External evidence status | BLOCKED |
| Git branch | main |
| Packaged commit | 62efcfff9684a06b01356cbd69988a5088ef572c |
| Remote | git@github.com:pikecode/procurex.git |
| Dirty at packaging | no |

## Local Evidence

| Area | Status |
|---|---|
| Performance | LOCAL_READY |
| Rollback | LOCAL_READY |
| Initialization | LOCAL_READY |
| Pilot rehearsal | LOCAL_READY |
| Browser evidence desktop | 11 readiness rows, 6 external rows, overflow=false |
| Browser evidence mobile | 11 readiness rows, 6 external rows, overflow=false |

## External Blockers

| Blocker | Meaning |
|---|---|
| WECHAT_DEVICE | External evidence required before production READY |
| PRODUCTION_RUNTIME | External evidence required before production READY |
| STORAGE_POLICY | External evidence required before production READY |
| PRODUCTION_RECOVERY | External evidence required before production READY |
| FINANCE_SIGNOFF | External evidence required before production READY |
| CUSTOMER_PILOT | External evidence required before production READY |

## Evidence Files

| Path | State | Bytes | SHA-256 |
|---|---|---|---|
| apps/web/m6-readiness.json | present | 4753 | 392dc9e73db6a2b3a395cd37566afd63c3c878ac9f73abc16895eeb50cb25a4d |
| apps/web/m6-external-evidence.json | present | 4110 | e594b367fc2e0c60dc614be5f82b9b61bdc0230b342e1da2507a405a5b8d1ef6 |
| var/m6-external-evidence.json | present | 4110 | e594b367fc2e0c60dc614be5f82b9b61bdc0230b342e1da2507a405a5b8d1ef6 |
| var/m6-performance-report.json | present | 2502 | ef810f1d3c8971f25c81655682576cf9f1408dc33b3c8c1af7fb87bbd4c92838 |
| var/m6-rollback-drill.json | present | 4421 | 6d5028efb0082f04e1473b200e973e5d97758bf23a906d5fb44d0c15fb5d3296 |
| var/m6-initialization-signoff.json | present | 4806 | 95f3ba32a422fdaad43a0b7f7a171b6b31bd3f6b83addc293f100e60bea2ce28 |
| var/m6-pilot-run.json | present | 4557 | 66abf81a69e53e2c0944787bf82481eef0b8ed2edf49e889e2c18027529377b1 |
| var/m6-readiness-evidence/manifest.json | present | 1967 | 6754cd5c5e26d54e20b5edb5399dbf7ef2d71bccc89779503dacb6ad2964c24f |
| var/m6-readiness-evidence/m6-readiness-desktop.png | present | 393489 | f4596f745d0e42e04ed3882c8a790bc91ece856605b5401019f0502ab95b0f6e |
| var/m6-readiness-evidence/m6-readiness-mobile.png | present | 1028239 | fbdff4e14d9f858d919f1106ee7ef2573303f7337c6632e804828eaa80f7b1e7 |
| apps/miniprogram/mini-flow-check.json | present | 2097 | 03357d581baa087de537c1c844fb55c460da619a738b1acef7a9387f942682d1 |
| apps/web/m5-gate-status.json | present | 2122 | 52708240ad461741a37aa4f9bc0865bfa2f1660288d7b1b3d1ebaf66f156631e |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 8880 | b6639f0e33ec4e1a1350f8d8bd11d526e28d108c206b8d440f9d61623cb4d42c |
| docs/m6-production-readiness.md | present | 9990 | 2120f52647eade58826ea1c65da868d672d19af4a54120683820aa9c67fff4a4 |
| docs/m6-external-evidence-templates.md | present | 1031 | 54b07a540d31876d8996f9fbd24549c2791035d14198d4ab7ad27cc820d9ec1b |

## Refresh Commands

```bash
npm run m6:performance
npm run m6:rollback-check
npm run m6:initialization-check
npm run m6:pilot-check
npm run m6:external-evidence
npm run m6:check-external-templates
npm run m6:readiness
npm run m6:capture-readiness-evidence
npm run m6:package-local-evidence
npm run m6:write-local-handoff
```

Use strict gates only after external materials are present:

```bash
npm run m6:readiness:strict
npm run m6:external-evidence:strict
```

## Remote Note

The packaged remote is `git@github.com:pikecode/procurex.git`. If the target repository changes, verify access with `git ls-remote --heads <repo>` before switching `origin`.
