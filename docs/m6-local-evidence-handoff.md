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
| Packaged commit | f6137a2468e7ba8c6487f9f7255765f28d6e8c79 |
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
| apps/web/product-app/shell.js | present | 2615 | aedc4bd5794c707b8cf72348116ac5fa5c412cd851ab52ba1a590e310fe2d413 |
| apps/web/product-app/workflow.js | present | 1441 | b95867c8dd40771e0339fa2ce7d3402eba782b090bca804bf0d5953169b722bf |
| apps/web/product-app/pages/overview.js | present | 6683 | 26f2115df46e5be45b03aabd65be93d16a04a2ab711ac649d4d45ae3d1ef369b |
| apps/web/product-app/pages/flow.js | present | 20858 | 26b97662c7e7716c44d46abd5d3fd4db93f2f5d45c9778d431fe41f53a6a3357 |
| apps/web/product-app/pages/store.js | present | 9503 | 48529a404d1f08d7521c61c99a9967ef866dce956596db6e40b6718f5268be2a |
| apps/web/product-app/pages/purchaser.js | present | 9256 | 25c05c4689d488b3b170af1179367b89da46aed70bb3ee63aed817e1b1858f0a |
| apps/web/product-app/pages/supplier.js | present | 12057 | 8cee0321e0f694b6f46ed435c2a251ef5fa18b17a69547e8ae1b544ac883ec00 |
| apps/web/product-app/pages/finance.js | present | 20210 | 15146417353ccdef6e8343e0fe6a3d29926fe83351790bf4a174c351bbf68d3b |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 28943 | f0f6d4486225c6df77024e94644c9e8e48891c268dac5a3a65e1c214f56d74ba |
| var/main-flow-demo-evidence/store-workbench.png | present | 238077 | c9d8fce9c58f41be452cf9c9422079a7a10cb709b28c20f5ba89dd12e2ee1f6d |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 503185 | 59561b16393b1aca8e2ca645fb137b9d25e6b009a1c2e54d3449ddef64c81264 |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 224740 | fef7b6e07e103a76d90cbc763a8da967608d4fc5c49b69bc36224398c0d750ca |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 455314 | 5b611064ad33d82d68d5f780d8a45dbda5d99237a62cbdb91b3b15fd25d6220b |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 290790 | dbc2dfb13014a416053d97515092c29e11b253edbc8679b5bb5d129370525100 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 611823 | c4f295eadc40ca90d5b6d3f4d333f80288812f85f45db13c9b60b6e6319134db |
| var/main-flow-demo-evidence/product-app.png | present | 269767 | 958c59d9b18169657e8fe849155447b473dfd751c23c2d70c4e98e341008fcf2 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 581714 | 0750119c88ae5b5c31e5124d49bf6ffcd4cf86930f5a1b376e5653516c007b82 |
| var/main-flow-demo-evidence/product-app-store.png | present | 199341 | 80faf833017c262b9164a6c5defc4ee9fadb9ba3ef17d9ef900f4a0149f2fb12 |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 180616 | b462ff188da8994ba17a10961f5723a9be26d8fddf2d7c3650451fc6325442a1 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 213800 | 172fefd1544b049157220af457b1b1313e9e66a424749b8aeb3cceeda4e3d52c |
| var/main-flow-demo-evidence/product-app-finance.png | present | 211926 | 7ba25fecd2800b2d8447badf82cc2694d4a68ddfe96057f16e55d5ef98abd0a6 |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 195188 | e0693e41fd0792527360cb46089737bb5830cccc97affec0b609091647f4bffc |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 231520 | c8648589f4dc08b2872da61ea0db738a00c86988476e6603426a7ed8f8315a9e |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 235613 | df4f4fc8bf83f100be2a28206748d6c342fceb774307448f6231f19b74f0406c |
| var/main-flow-demo-evidence/product-app-finance-pending-action.png | present | 282782 | 583652a10ea5565d08cd135d9384cb3edd39a17ffa91d963c6062a41a3f18d1b |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 216971 | c8caf8671d3d749bf9caf3a2faba7d93ecfce2e316d80368c560bfd9cd548644 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 492120 | 1026046346edfa1c89be8b65cabae3b11a88a4597bf19ad5059692a841bfddb6 |
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
