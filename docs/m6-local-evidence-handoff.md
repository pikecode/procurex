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
| Packaged commit | 333e8b7f1229ec4cd08727b50689309e4fdb859d |
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
| apps/web/product-app/shell.js | present | 2736 | 9b19dbe53f3f8bb3bf6ee60427c38b721791ae705c96e01be103c489b31ce5ef |
| apps/web/product-app/workflow.js | present | 2622 | 497b482ff9159cc6db8a35f5fe32be54f15f7a68d48fb2d72a36249a29cf18d0 |
| apps/web/product-app/pages/overview.js | present | 10199 | 21dd1950d97b1c3a7ea479d8cf8c1a0fb5b606ed709ea4111963dce86b42eac0 |
| apps/web/product-app/pages/flow.js | present | 21328 | e3524342871651102135cb0cb2ef4c7bb47669f6754048fc53b4e29f8c077d6a |
| apps/web/product-app/pages/store.js | present | 10818 | 8a6e9aa976929760bfb67e1461eb5e13e8d93d66dc238e099f931bdcad5675de |
| apps/web/product-app/pages/purchaser.js | present | 10921 | a13c893f0403c5ab0b3270ace7e2ad908aaed6e5daec87b0c45395a295c70944 |
| apps/web/product-app/pages/supplier.js | present | 13313 | 9305cb882543d22c3c3c14b28a01edc74ea32fa6f4ba8752a0145f21ba367498 |
| apps/web/product-app/pages/finance.js | present | 20356 | 0e115389dd6d01a795b39e4b8b2102674bececedda92fcbc8684c089d3e79d43 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 31669 | ef6f0701d86db1614004b019ec6baf5f124d14bf3cf0e9aa9ca2590bd4fbcb6f |
| var/main-flow-demo-evidence/store-workbench.png | present | 238267 | ae9e037422066fb2be2cedafe6ca40790be5f07a014772fc9182dd84c1a9c38d |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 506375 | 4a6f20dc591fa3df989a581c2b41a37be5141e4d7515df2123cd75429b70535e |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 223997 | 77b85873c14f005bc9f9308e3ba9593e307db7ea8eb32e7e212e634cfb4d9b76 |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 456963 | fd1d7d73ffc5dd208338c9e5a41afdbf40c545676f693b696dcad0fbd9e54eb9 |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 291173 | c935ddfa0aea4e112793045da0cf060aae92a7855de36fdc4f82cd5929af78bd |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 609685 | d1ddbf78385dc514910d47cab502a3d430f6e0af9f629e7f02ee8e44f7016da0 |
| var/main-flow-demo-evidence/product-app.png | present | 277543 | 46c1fed4819bde717c34885fbb0c2aeb25266f585d9cfafc2c88f5455d01291b |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 600140 | aabc85b8a8d214b5817d7b22dea1551219a7e2dd5f39735ace7dd6427cb03d42 |
| var/main-flow-demo-evidence/product-app-store.png | present | 200829 | d433ecc1df607ea55266bb45d997736b64ea9a28a8310694f2b913f4a07a455b |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 182050 | 1a5b53320b98928bd6d0b0f33a74b5874cdc80afd41dcde318261a2cdcbe0920 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 216137 | 439f3f1f26d53c979866adfb9d153fd0c36d4dd98c1eb6d4e73ccf29266374ee |
| var/main-flow-demo-evidence/product-app-finance.png | present | 213255 | ad7f462aeaa6a403d7d20d660e80a88e0dede19e353b5b7baf798ec60ff9fb2f |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 195959 | 4aa4a15da8570453424c4686ee89fd743f69de3737f45a773ca19bfcf15a270f |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 234039 | e7edd0b7ef67efc9072d3b4ae568f23f58ee4ddfdf78bc5d7774623f5af0b4b4 |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 236622 | 45114007554c12d1d6ff3d3b63bbd04ed1e5593d4eeb36958803e7be2a096ca2 |
| var/main-flow-demo-evidence/product-app-finance-pending-action.png | present | 289173 | 3c044506b811cbbf335f5f90287de7090abe0093fbe907f77ca0b007648277e6 |
| var/main-flow-demo-evidence/product-app-workflow-refresh-flow-action.png | present | 197799 | 6c49100665951f0950c56f1fc67db0d7094b1fbce222033487248783963ccd82 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217203 | e4383dfdd928e5c195ea3d3f39e257cb75e27d7b6a6670ca9bf6861cd50cb1d5 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 491736 | 33dcc3e23c05b27626efc6b951dccb04c0759d774a37a316db991289b94e4c88 |
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
