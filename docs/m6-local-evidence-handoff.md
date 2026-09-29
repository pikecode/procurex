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
| Packaged commit | bbe2dd7395b54a3ef019b20fcf1d6edf284e6254 |
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
| apps/web/product-app/pages/finance.js | present | 19288 | 13a08c43bc5c5281f2746ad0da17eaa9ecc4dbeca5f2c026f32e9e979a654222 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 27732 | 693b792fd288f9405986da69a603cc88d8d723194f235c6dac0145f89e71fd51 |
| var/main-flow-demo-evidence/store-workbench.png | present | 234774 | 47fcd7bf3a6ea960f1b76e6cbae07e11c5c52ea698244976f813da6773785164 |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 497185 | 3fcf1320201229e36d15b87f4c995d4b6bea18c683936c8c9aa7e8041c7980f2 |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 223207 | 7d55e783ac9c68353d85edaca86b3178a38472f0f919733e69027dd9550590a9 |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 453723 | 73b515619cff72572257148656032e0e66e3e8bc9994852c180a4522855eb6e2 |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 289486 | 10415754e9d8019bf24edeec88c6ed2ee7ded30d3ee10955b9466e7ff74db33f |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 607629 | 7dca5bdaa45d75f27c15302863abb26413b1e00654cc8d2f2fe4d5f77d87c161 |
| var/main-flow-demo-evidence/product-app.png | present | 270171 | 094c6bbd1e7ca4db4e5af492dfe31bbc34d5298f0838c5a50faf08b736f49658 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 582029 | 508003d01c19b5ee4b8fd06d77a3ca07c6800371624a2e38927e55ac8ba488b9 |
| var/main-flow-demo-evidence/product-app-store.png | present | 197690 | bffa56cb8aa27c08ab9235f05725ad8b44ec733377c877e9370c99a6bee6acd2 |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 180288 | 4999224b91e95bbbd4dd04b1996d1f3ffa9525203b5bc62a574d28aca68bec84 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 212805 | 1b28b48754d264930c11ff8fcceccb7623bd4cd9c0dcf194367e0b213aee37b7 |
| var/main-flow-demo-evidence/product-app-finance.png | present | 212713 | d761af74150a7784ab88d3081c56a436ad2163c4b9a3925272543492ebda1c06 |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 193966 | 80a26a07397325fdf565e7255d0b6da75ff3f03df54db5682f9ab2f640a7c576 |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 232455 | f530e11bee8b0e1e4aa41c0b29248c7586d612e9e6c3b4eea2c020b66f2a4d60 |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 236258 | 66d1e81d0c0f5d3b137d3f81031ad5809e96841c559db435c49785a44efcd2d8 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217134 | bf986b851d9f964fbeee46bb4529fe2bb5f4a18f4408e17d9011c7bf009bdc43 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 491201 | 4d03fd3a22c1e8a04301143700a6307da400cf83208758711d95dd4b34c10178 |
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
