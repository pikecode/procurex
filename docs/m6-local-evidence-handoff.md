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
| Packaged commit | 80bd9ca7439b423fe743ce9868720f643b734396 |
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
| apps/web/product-app/pages/purchaser.js | present | 6633 | 04935cda435eeca38936e95ee84a0c7f549a04cb555ba021f2f8a30c586a9c36 |
| apps/web/product-app/pages/supplier.js | present | 8835 | 1fa38ff30be98df6fa164a1f4728e012de379ec87b50b824e371a03af2560117 |
| apps/web/product-app/pages/finance.js | present | 13413 | 6db061a15beabb32ca4e0418c44fc85bf56c6024661e8bcfffdf62877171736e |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 27732 | 698ee95505dcab961dc15d11f2fe53af16ed6d6a56497bc5afb9b84fb588f770 |
| var/main-flow-demo-evidence/store-workbench.png | present | 237072 | 7442cc8b7bebdc95aecb508c18553c80a52f5634d39859eaec19559560d03fe9 |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 504028 | 6e90f970ba66e8081e072fd8c11f394f3a7995892b10ec9c1f51e0f252b0a333 |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 223198 | bdb7b8159a70e168315e22d1cf209a79fc51b2e53233d4094329f4a6d830a59e |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 455449 | 74320706e171fb3b438480008c2f2b4a900a5d3852ce76c191912496f6f86de2 |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 289388 | db3c7682fa0be2f216992e6ccd9bc86c29c3d10973c01cbd9bb85f2ef45efbf7 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 613217 | c0fb003c85efb0932ffa9dd2fc1063861b8903037e7251d0bd47bea64815a856 |
| var/main-flow-demo-evidence/product-app.png | present | 213129 | 99c486ba0615b8f7effdce4aeb47f70908fb7f5907de10781406a60b0141bc66 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 461308 | 5ae6351ba5018584eff6a7a6be0af25b18ad990a274cdcd84c4629a4acb60347 |
| var/main-flow-demo-evidence/product-app-store.png | present | 199298 | 27a5177ec44a7378f2063f12358bc004c68b05f24b0d97c8fb213ce2a829873d |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 164852 | 9c765316e511f0b77d516a46b0cb2d45fbbf490f6b09e4fe993c526f9bb7f06e |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 206678 | 757ea4ca92bb0d4f21c672f4d2bd5f319c532759a3adda3e96714abde30bf55f |
| var/main-flow-demo-evidence/product-app-finance.png | present | 179858 | 71293d1087d2c9071c81211a39a404ed3a60f1b0527297c733f3c6e1a8b3f91f |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 163762 | 669ba1f4bad5fb6fcb449ff629efc708712b2e1663165304661cc68a977e5cee |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 184298 | 9119bbf5b0f8d4f7611fad1747a3e104ab5b811d1d146b70a4f7f52eab6abc1c |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 188243 | adcfd9103d511efb7c1bda644a37d640c70526ddd3f20fbd88e57792519ce636 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 216927 | 869b5d81762ff5bdde15dd702794a31cfb6b87f1b3bf8db8a047e54e4f0c47e3 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 491240 | 6b16c91a113e0cb60dccbb62aaa7d8531a98be418899bca00c778b92059215af |
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
