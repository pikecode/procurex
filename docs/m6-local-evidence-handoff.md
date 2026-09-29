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
| Packaged commit | 44644bbd44855eef55eab48eec01cd31002935d8 |
| Remote | git@github.com-pikecode:pikecode/procurex.git |
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
| apps/web/m6-readiness.json | present | 4956 | 7e7c1e09aaf1c871f96f86caa47b5f1c02fbb56b428c630a8649a0e5d61a95b6 |
| apps/web/m6-external-evidence.json | present | 5044 | b9ba498720ea41af6797e57607fefe902a3d9f37721934295b1785acbbf2f161 |
| var/m6-external-evidence.json | present | 5044 | b9ba498720ea41af6797e57607fefe902a3d9f37721934295b1785acbbf2f161 |
| var/m6-performance-report.json | present | 2502 | ef810f1d3c8971f25c81655682576cf9f1408dc33b3c8c1af7fb87bbd4c92838 |
| var/m6-rollback-drill.json | present | 4421 | 6d5028efb0082f04e1473b200e973e5d97758bf23a906d5fb44d0c15fb5d3296 |
| var/m6-initialization-signoff.json | present | 4806 | 95f3ba32a422fdaad43a0b7f7a171b6b31bd3f6b83addc293f100e60bea2ce28 |
| var/m6-pilot-run.json | present | 4557 | 66abf81a69e53e2c0944787bf82481eef0b8ed2edf49e889e2c18027529377b1 |
| var/m6-readiness-evidence/manifest.json | present | 2183 | 64e86ece454edd9855d3bba693989518c469ca117d0824cf4a7193e4f44d4d8e |
| var/m6-readiness-evidence/m6-readiness-desktop.png | present | 449847 | 065d1a60566a8d6d4ba79971982e491890fd38613346816880e1ac841cda35a5 |
| var/m6-readiness-evidence/m6-readiness-mobile.png | present | 1179247 | 33d785116ddceb1c934b05d376125d0e2f1574d460316b88d4a307a98f1869de |
| apps/miniprogram/mini-flow-check.json | present | 2097 | 03357d581baa087de537c1c844fb55c460da619a738b1acef7a9387f942682d1 |
| apps/web/m5-gate-status.json | present | 2122 | 52708240ad461741a37aa4f9bc0865bfa2f1660288d7b1b3d1ebaf66f156631e |
| apps/web/app.html | present | 348 | 59df6ba85c82b57bd2ded02b2e7536648939df873ef971a301343e4120c2f1ef |
| apps/web/product-app/main.js | present | 890 | 67961857fe7fc248fac55ba55144220c45ddaa2b8c60493c58ec1e1c6762e1ed |
| apps/web/product-app/api.js | present | 1017 | 482f25633a22f71b2eb87e0cc7d1a843bcea3ed2e70ad6e028b5e91ffde89f99 |
| apps/web/product-app/shell.js | present | 2615 | aedc4bd5794c707b8cf72348116ac5fa5c412cd851ab52ba1a590e310fe2d413 |
| apps/web/product-app/pages/overview.js | present | 4926 | 77aeb6f208ef16a6087debfc9722a3a563232596469a2e61463a91b4524eb7d1 |
| apps/web/product-app/pages/flow.js | present | 18618 | 03e83179acd04f45b0c523355438cc3763ae3b288bf305f991ac2883a43ecacd |
| apps/web/product-app/pages/store.js | present | 9279 | 878a7c9a40f96427a32e6a8db8d206adb0b300f7112944a7430add52c75a95ac |
| apps/web/product-app/pages/purchaser.js | present | 8996 | 8d76e89975a54a7efcd53394cabd46c003c2ca124e5f60da2558093ac44cde3a |
| apps/web/product-app/pages/supplier.js | present | 11479 | 07ad18e260bbaf2d6f300c27d063afd485a3356d2ffa15e15dc0c407c5ef7cb0 |
| apps/web/product-app/pages/finance.js | present | 13413 | 6db061a15beabb32ca4e0418c44fc85bf56c6024661e8bcfffdf62877171736e |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 27732 | dd70aa4d4adda7dd80b8381a5615451c3e811e0fcd314a1efc7fc5c1c1183bfe |
| var/main-flow-demo-evidence/store-workbench.png | present | 234317 | e091d4641c28dca8bfc8104acd1799501a1590023fe58b60110e92f751aebcf2 |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 492061 | 1a32df2df359d2bd779e6afc7bdb7e25a41215f52ca42d538a7720adf13375cf |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 222300 | c6f5a74845f8d0c52cbeb2318240ca6c948eb0302235446df6c064391ca0cd44 |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 450698 | 089f3febdb71fab54e324858a0c98e7d23dfd773929c8c1951b9eb2503b32381 |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 286460 | dc21873a7810c2f7fb33f72fa631ea46fbf39cd21412cbcf4edf99e7f92fdb9e |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 597654 | 9e466ae9dc9640b0df97a1fe9e1e04de32fca910ce90459cbf7fa13f71a29175 |
| var/main-flow-demo-evidence/product-app.png | present | 212788 | 52f275f7c6032c8fd7da65dc3b90ecb4fb3d921701b4688d8953545d6dc346e4 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 461645 | d4c4237f891f8c124589e769770cbfeb465139ab66dc911a9fe2fa6ce5b6418e |
| var/main-flow-demo-evidence/product-app-store.png | present | 196458 | 4f4bb20d6119bc3776be7aa4b46b2704e4cb846abe4dc773a701899debe65628 |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 179889 | 6eb3eef4ee2a027e9c6daff408606552c6c475451cf3d735aee7b56b579b53ed |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 206151 | a07217268d35a4186ed5ed3ccb470e67098e0213841cf7c3bacfbd8571d28f58 |
| var/main-flow-demo-evidence/product-app-finance.png | present | 179746 | 7d7e88e8705eb59874767f0bcc9b78dbba59725c12cb613512330c869817d2dd |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 163285 | a0aad4fae6399980ef76500f024040e941d0c70f12c0209266eb5f10467fe3b6 |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 184343 | 7b3df649d35ce2697fa2e2819ea713e36f10c07cce702758ebfa8d296295afe3 |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 187836 | 92031886f2189aacd48fb6dc4775e8114276cd43ab23b4da496183c108a083a7 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 216795 | 53cf7e400032812d2db62f4bdf8a4c6dd6984961f8867cdb91884dc3ed550e37 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 490980 | 431e466abe63d587012f162025305b4618133e0dba4b280edfb5d23fbac0b53a |
| docs/m6-production-readiness.md | present | 11898 | 37d23fd1a01ebcff1e91357f816b34fa73d31b06e1a69a95c541c54a173b0305 |
| docs/m6-wechat-device-evidence-guide.md | present | 3506 | 340c17a8fc01c55707ea06a20a3e791a3b1702a4c88c663ecbd97fd6bcee893d |
| docs/m6-production-runtime-guide.md | present | 2586 | d0092156325942a22878c316a0762e3fc9900fb35db0596e5378055c4e02ea98 |
| docs/m6-storage-policy-guide.md | present | 2160 | 3cdc50a7efe026f76d5aa58a33f36080d6d079c8444deb99fd720416d59e2544 |
| docs/m6-external-evidence-templates.md | present | 1155 | 121ffa87b542061489b4fc078e013538c6aa370aba9279017b31eff718a233f6 |
| var/m6-production-runtime.json | present | 1974 | f8998157202763f0bf2b8a4163bb735633af71f176f8618d5db89598b5aa4f75 |
| var/m6-production-storage-policy.json | present | 1113 | 4aec7851ec937558cf2dd9d91ee8a6bf2ad6dd7481d997d938a1c31149a386a7 |

## Refresh Commands

```bash
npm run m6:performance
npm run m6:rollback-check
npm run m6:initialization-check
npm run m6:pilot-check
npm run m6:prepare-wechat-evidence
npm run m6:check-wechat-evidence
npm run m6:check-production-runtime
npm run m6:check-storage-policy
npm run m6:external-evidence
npm run m6:check-external-templates
npm run m6:readiness
npm run main-flow:capture-interactive-demo
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

The packaged remote is `git@github.com-pikecode:pikecode/procurex.git`. If the target repository changes, verify access with `git ls-remote --heads <repo>` before switching `origin`.
