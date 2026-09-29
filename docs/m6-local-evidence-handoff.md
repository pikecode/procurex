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
| Packaged commit | 9cf95b18de9bc43c0c0fc6461abbe8a28e2415d8 |
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
| apps/web/m6-readiness.json | present | 4904 | 4e70b4ca5babf8b4e8363509e488b78ace9a1ce947f5f7e6df6e01594ea0a063 |
| apps/web/m6-external-evidence.json | present | 4888 | 20ee4be6b62291f5386ad08c3f364ea356225441cf16ee89657a52d36b799fd3 |
| var/m6-external-evidence.json | present | 4888 | 20ee4be6b62291f5386ad08c3f364ea356225441cf16ee89657a52d36b799fd3 |
| var/m6-performance-report.json | present | 2502 | ef810f1d3c8971f25c81655682576cf9f1408dc33b3c8c1af7fb87bbd4c92838 |
| var/m6-rollback-drill.json | present | 4421 | 6d5028efb0082f04e1473b200e973e5d97758bf23a906d5fb44d0c15fb5d3296 |
| var/m6-initialization-signoff.json | present | 4806 | 95f3ba32a422fdaad43a0b7f7a171b6b31bd3f6b83addc293f100e60bea2ce28 |
| var/m6-pilot-run.json | present | 4557 | 66abf81a69e53e2c0944787bf82481eef0b8ed2edf49e889e2c18027529377b1 |
| var/m6-readiness-evidence/manifest.json | present | 2109 | c6f2ced00394139f5e3b5925247657f52d1f67f167b879a4ab4214e1d0dcbd42 |
| var/m6-readiness-evidence/m6-readiness-desktop.png | present | 439166 | 39f1b5efb8080fe3b3627ebec0558af38154008abe66258d72618c2d2292d3e6 |
| var/m6-readiness-evidence/m6-readiness-mobile.png | present | 1149673 | cf116bb34d754f32be56e0e97ad7eaab4a2448c232fce5b06cce40106be08c12 |
| apps/miniprogram/mini-flow-check.json | present | 2097 | 03357d581baa087de537c1c844fb55c460da619a738b1acef7a9387f942682d1 |
| apps/web/m5-gate-status.json | present | 2122 | 52708240ad461741a37aa4f9bc0865bfa2f1660288d7b1b3d1ebaf66f156631e |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 8880 | b6639f0e33ec4e1a1350f8d8bd11d526e28d108c206b8d440f9d61623cb4d42c |
| docs/m6-production-readiness.md | present | 11452 | 4054d0343a730fd01b58db2bb2376e2fa08733fe22c3c596ec04dfd4b49dc120 |
| docs/m6-wechat-device-evidence-guide.md | present | 3506 | 340c17a8fc01c55707ea06a20a3e791a3b1702a4c88c663ecbd97fd6bcee893d |
| docs/m6-production-runtime-guide.md | present | 2586 | d0092156325942a22878c316a0762e3fc9900fb35db0596e5378055c4e02ea98 |
| docs/m6-external-evidence-templates.md | present | 1123 | 900cf458c8d8b0a4d9a14ce64c51d01d6b9d7cfd90c656e9d69b264af985ef46 |
| var/m6-production-runtime.json | present | 1974 | f8998157202763f0bf2b8a4163bb735633af71f176f8618d5db89598b5aa4f75 |

## Refresh Commands

```bash
npm run m6:performance
npm run m6:rollback-check
npm run m6:initialization-check
npm run m6:pilot-check
npm run m6:prepare-wechat-evidence
npm run m6:check-wechat-evidence
npm run m6:check-production-runtime
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
