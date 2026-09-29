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
| Packaged commit | b4092358ca7fa1ee4f3814b0c1ffa7d55b6be53a |
| Remote | git@github.com-pikecode:pikecode/procurex.git |
| Dirty at packaging | yes |

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
| apps/web/product-app/shell.js | present | 2736 | 9b19dbe53f3f8bb3bf6ee60427c38b721791ae705c96e01be103c489b31ce5ef |
| apps/web/product-app/workflow.js | present | 2622 | 497b482ff9159cc6db8a35f5fe32be54f15f7a68d48fb2d72a36249a29cf18d0 |
| apps/web/product-app/pages/overview.js | present | 10199 | 21dd1950d97b1c3a7ea479d8cf8c1a0fb5b606ed709ea4111963dce86b42eac0 |
| apps/web/product-app/pages/flow.js | present | 21328 | e3524342871651102135cb0cb2ef4c7bb47669f6754048fc53b4e29f8c077d6a |
| apps/web/product-app/pages/store.js | present | 10818 | 8a6e9aa976929760bfb67e1461eb5e13e8d93d66dc238e099f931bdcad5675de |
| apps/web/product-app/pages/purchaser.js | present | 10921 | a13c893f0403c5ab0b3270ace7e2ad908aaed6e5daec87b0c45395a295c70944 |
| apps/web/product-app/pages/supplier.js | present | 16720 | 6cf3be48068a9e21d6ccdc0a3fb36f315275d4cefddc234f431c6d53102979f2 |
| apps/web/product-app/pages/finance.js | present | 20356 | 0e115389dd6d01a795b39e4b8b2102674bececedda92fcbc8684c089d3e79d43 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 31669 | e7b01c03169e3317385e3a35f28bbe4c013e1e00e4da4a3e9cae6fae0a115efb |
| var/main-flow-demo-evidence/store-workbench.png | present | 238084 | cc66bdf374836e0bbcf6d76dba3ab1c6637127cf4922408b132fc3ec63480399 |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 502001 | 6a1a5ee3a02b3dc8323e2d6e72305d09112cb991830de2d886f612e7b79e01a3 |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 225180 | 908e2d25159dc7a2fcc7009b477fa9607ee81679bc4adbe2dfd04b8c18e3042e |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 458041 | 933ce7fdaf9c2dada634fdffea77c704944ee0b1d505e809179c8d18e31749a8 |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 289985 | 4a8b1fa0573a2d22dfa7d6e927dc12b1644c7d53c122649befbdf8cb1dcc0c28 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 611740 | ff1ff6a262b0bf0554144a173278387929653562c7328e52a0bac91073788de8 |
| var/main-flow-demo-evidence/product-app.png | present | 277843 | bf30dddfc840cf9115ddb0278feec30a87634396eb277d3fbec1aa83e2340412 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 600281 | f984183767b6c1d789d65797f3e1f1362eece1f8524b31974a11ed452c2a7b9b |
| var/main-flow-demo-evidence/product-app-store.png | present | 199440 | 4e37a7a2671a6ca81cadbf06bfa490792bc6103140e91c6f58225601386cd06f |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 182976 | 80c032f108ac4396a32fcb15380629e6d11571b27749a86805cb8addb80df0e3 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 219910 | 58dcc98cd3c4398a8a9aa6534ff54159abd8ba79072727d579dd5b12fa04db9c |
| var/main-flow-demo-evidence/product-app-finance.png | present | 213375 | bae2f8923c22b4ac61f13ded00285c773633959531dd5a96b5481fce97b265a0 |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 196184 | 3a66f40dad7a0986a20af3cce4415406e27db750d092d748af94d1f019f7d48d |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 233348 | dd833c26fe42354b230b06b74dd3c57aeefc19401f7813700a7333420880410a |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 237670 | d923c3ebb7938685ce3d7e88e1e93d449195b3c3034b7adb0576da5f0643dbf2 |
| var/main-flow-demo-evidence/product-app-finance-pending-action.png | present | 289574 | 99216c9b31eed0fcd60994a850dbe99c9064205b08a71b8a964280b8f8491667 |
| var/main-flow-demo-evidence/product-app-workflow-refresh-flow-action.png | present | 197476 | fafa698823a684a502d47bc3728ebea01f5ba8d6ac4370708397a68e293d20f7 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217130 | a276b62844a360ee37d8982196a613fd8387f6ea342114c3cb970c506012a446 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 491189 | c97de99b047866757c6467919a56a907bdb68a3623ee074a2763ac88c396d765 |
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
