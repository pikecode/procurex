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
| Packaged commit | 23d9d816775487bbc85e9fd5b9f731a5ca917842 |
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
| apps/web/m6-readiness.json | present | 4791 | 219b5a610a6e8a765be2f9db6c01987ee9b100e6b2b85fce8eadfa8f78624c47 |
| apps/web/m6-external-evidence.json | present | 4537 | ef9fc0e2d83f0e5877e722cf6cb648133c025475f51d43915a05fd8310482826 |
| var/m6-external-evidence.json | present | 4537 | ef9fc0e2d83f0e5877e722cf6cb648133c025475f51d43915a05fd8310482826 |
| var/m6-performance-report.json | present | 2502 | ef810f1d3c8971f25c81655682576cf9f1408dc33b3c8c1af7fb87bbd4c92838 |
| var/m6-rollback-drill.json | present | 4421 | 6d5028efb0082f04e1473b200e973e5d97758bf23a906d5fb44d0c15fb5d3296 |
| var/m6-initialization-signoff.json | present | 4806 | 95f3ba32a422fdaad43a0b7f7a171b6b31bd3f6b83addc293f100e60bea2ce28 |
| var/m6-pilot-run.json | present | 4557 | 66abf81a69e53e2c0944787bf82481eef0b8ed2edf49e889e2c18027529377b1 |
| var/m6-readiness-evidence/manifest.json | present | 2027 | 381292ec9c2408c43ada38f12da43dc277086d3144b36b268c74f67a1d8ea7de |
| var/m6-readiness-evidence/m6-readiness-desktop.png | present | 426104 | a38a63f12d9da1261193c45287b3339bf6620b91335f0b53398d3724e9edee75 |
| var/m6-readiness-evidence/m6-readiness-mobile.png | present | 1119646 | c809dab647700cd09a0f21259341fa3ff0d402fef89c568e42f6d9655273e5ac |
| apps/miniprogram/mini-flow-check.json | present | 2097 | 03357d581baa087de537c1c844fb55c460da619a738b1acef7a9387f942682d1 |
| apps/web/m5-gate-status.json | present | 2122 | 52708240ad461741a37aa4f9bc0865bfa2f1660288d7b1b3d1ebaf66f156631e |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 8880 | b6639f0e33ec4e1a1350f8d8bd11d526e28d108c206b8d440f9d61623cb4d42c |
| docs/m6-production-readiness.md | present | 10893 | 4315cbe0fbbd0fdc73aab1a65f33744c0dc77318cb8257ca4b82819acd6797fc |
| docs/m6-wechat-device-evidence-guide.md | present | 3506 | 340c17a8fc01c55707ea06a20a3e791a3b1702a4c88c663ecbd97fd6bcee893d |
| docs/m6-external-evidence-templates.md | present | 1031 | 54b07a540d31876d8996f9fbd24549c2791035d14198d4ab7ad27cc820d9ec1b |

## Refresh Commands

```bash
npm run m6:performance
npm run m6:rollback-check
npm run m6:initialization-check
npm run m6:pilot-check
npm run m6:prepare-wechat-evidence
npm run m6:check-wechat-evidence
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
