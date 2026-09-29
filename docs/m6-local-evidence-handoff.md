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
| Packaged commit | 6704ed5141ceb035ef7e62a9342f86a5e217e123 |
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
| apps/web/product-app/main.js | present | 787 | b8f6befff66c5092bff4c2d60a27864e7dceae595dbcacfa877038b683ef1588 |
| apps/web/product-app/api.js | present | 1017 | 482f25633a22f71b2eb87e0cc7d1a843bcea3ed2e70ad6e028b5e91ffde89f99 |
| apps/web/product-app/shell.js | present | 2562 | bd028003417c5ebf19d4a901bcea6935ac0f998927c738f11db2547fc2043a29 |
| apps/web/product-app/pages/overview.js | present | 2315 | 4e0b443b978576f9e5bbb449caa3c6a713f5ff7f34bc4dabe38ccc0e4595d7c1 |
| apps/web/product-app/pages/store.js | present | 5577 | 5bfeda292f7778872b6ef62bdfada6887c57e9343f0885b22de1fbad5009f544 |
| apps/web/product-app/pages/purchaser.js | present | 6633 | 04935cda435eeca38936e95ee84a0c7f549a04cb555ba021f2f8a30c586a9c36 |
| apps/web/product-app/pages/supplier.js | present | 8835 | 1fa38ff30be98df6fa164a1f4728e012de379ec87b50b824e371a03af2560117 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 22861 | 76c0eca502f786f803245fd8845fcd6301efcc710ff770d157c0977624281a64 |
| var/main-flow-demo-evidence/store-workbench.png | present | 237330 | c86770f720bb67bc6c276eb4bef1012d2d1a00b1e56059fee08d28cda9a88acf |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 503871 | 878a3ac77a8cd85ba68f7b6423dda7ef4ef91700009c97f887acb40e244ee08d |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 223706 | 8f2d3d5f54a57831bed0c73a0fd0bf2b9490cd595e8eeeae1edaea8f7f4ea608 |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 453833 | 9133929b2e082b760ecab19523ff42617d0083d6dfdfec8bb50c8f82376d4377 |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 289760 | 1747330328b02981f7974db1216496525f07bbe65f818928feda33b61f76f4e0 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 608234 | 79f9dfd6df5c9c951a79db48349f4af5e2f7bd166a13048ef1dd0d4b6e4dd16a |
| var/main-flow-demo-evidence/product-app.png | present | 112457 | 90697b0fd521df96e72edd296a56c105ea8d538266e079f2ea935f839591aa96 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 233749 | ab2afa1bebed718fa7731f1e3803e8715ba703e10a6443de0cd138d56ec6d195 |
| var/main-flow-demo-evidence/product-app-store.png | present | 166779 | ac9c762c201bc5fc8f5600c766c90032d227d8b68cae230d7fd1e258ed529411 |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 162031 | 66c110ed4504a85492e19ae2cdee3200e9d5787d043b9e9281923a8ba5140015 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 204274 | ee9263f3f80321e3c6505d21991b19afe9717120dad071bf1564c1078bffcbc3 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217146 | e2787039468d5f42afb136f34c32c139bbf2effe61f18b73eb2abb0a05580497 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 492057 | 735143ed5097f9fbc86868fb31ad6093a5b1ac9119c71e03a7db15dfa9f758c4 |
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

The packaged remote is `git@github.com:pikecode/procurex.git`. If the target repository changes, verify access with `git ls-remote --heads <repo>` before switching `origin`.
