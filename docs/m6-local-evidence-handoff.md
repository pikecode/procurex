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
| Packaged commit | e0b56654268290584b78c06a06ebb15824d7acae |
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
| apps/web/product-app/pages/finance.js | present | 18612 | 076109ca465f4d38845d6093a72fc30ae6b92c25b87f8d3da9dcbe3850dfa942 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 27732 | 878b92c9586c6e867a86cb9dad27760153cb0c19956079e00ca64395f66e1f98 |
| var/main-flow-demo-evidence/store-workbench.png | present | 237601 | ab5a912f1d24af42e00973c6e45baec28218f4f6258e8bfd4959a2ab3d053650 |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 503779 | 9c01d6e7fe2b3d81d9963e7cd4efe3ea035a3ce56221db17984cf234d6c71b5a |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 224165 | fc3958b9f13929280eeeb6f6d5a523355e6abe3e8aae3a106caa1cc0a4aa6c88 |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 454731 | 2db709e82002974f758259c1a5fc42dc8caca5ad0bae502ecbe4ba15fd6de48d |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 290175 | 17427be4803107299eb204f57579c5e21d5bf7712092d5023b0f8dea7e88f486 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 603392 | 4ee294579f55d9d593d2ae5b696d2c30fcf98f00b9c8573308a3c4eabe2cd10d |
| var/main-flow-demo-evidence/product-app.png | present | 213123 | 28e4d25e5baa0003322b0a2d31f136304b8cd3313705fe02f4609e76174381ed |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 462389 | 46ffd68c43a5ef64969424b3d5f647600532dda7065bdda462b6cc4c602d477e |
| var/main-flow-demo-evidence/product-app-store.png | present | 200121 | ea1770d3093504b3f35b5678892a7be246b6c810ee4c74227b11d5e19a0440b8 |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 180628 | d391ccfef797b2ed0a76e6f39b5dae9b7d560ec77655c287eec1edd1fa693b2d |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 214675 | fd6e78595758cff4133571cc1f374541c853a60ea43baf7c60f8c8307921e62e |
| var/main-flow-demo-evidence/product-app-finance.png | present | 212631 | c5268baba869f24bd583f18fa948e8ed2919ee41d3d435e7bdb9b1701996c6d8 |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 162330 | 28cf9b01e708ceb6f9b282f7700fffabf3ef0414fe67449d45c213652ddb6b44 |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 232229 | bf9cf4aaf7f67dafd2b9f3b7772c55eef849e2865aeadfaf7a89f932aee4b1c2 |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 237154 | 1e4418cca2823f74ccde4990f11d25b86d98e36d833c9d423c48a19ae4a3c7b7 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217253 | 32eb4bd54697af58b90ee356b2da24963a19e95ec3cc0fc577187f3b306e79c0 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 492201 | b236a70611ef67343d1fbdb0d943f75189a8880f25dfd007f8e507c9c11d9b75 |
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
