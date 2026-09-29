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
| Packaged commit | 0073eabfb9bdb7bb12e41ae19cd85faf3b60b819 |
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
| apps/web/product-app/workflow.js | present | 2255 | 47374d76f7f6a12537762c312b8423ee693977598a50dd441bd6facba96e9fea |
| apps/web/product-app/pages/overview.js | present | 10199 | 21dd1950d97b1c3a7ea479d8cf8c1a0fb5b606ed709ea4111963dce86b42eac0 |
| apps/web/product-app/pages/flow.js | present | 20858 | 26b97662c7e7716c44d46abd5d3fd4db93f2f5d45c9778d431fe41f53a6a3357 |
| apps/web/product-app/pages/store.js | present | 9817 | 68de9a55fd598925497b7df41062d26361172046b39c8be31112111d54a76d8d |
| apps/web/product-app/pages/purchaser.js | present | 9457 | 13bfba8908465812e912fd06f751b5337e9763996777dea9bf74b426921dc138 |
| apps/web/product-app/pages/supplier.js | present | 12381 | 4a5d1496175414a32cbda472e8c20ca41d30c7dce16c842ab3424cc740c138e3 |
| apps/web/product-app/pages/finance.js | present | 20356 | 0e115389dd6d01a795b39e4b8b2102674bececedda92fcbc8684c089d3e79d43 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 31213 | 3623b956497f23d2361a5ba667e470a6b3420fcd201cd51af811c6754dde799e |
| var/main-flow-demo-evidence/store-workbench.png | present | 233533 | 9d935a989bcae5652284fea82259d6cd392999727cfe5cc16df51793ef5233aa |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 492889 | ff3e1786200d62069613c32bb72d6a97c51a0dfcf1f3abe64ecf8998de2c992d |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 222077 | 83f3faef8cd22037beccd5cb758e360a2bf9c1de079b3946afac2dd38714bade |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 447751 | 1352f715ac6dcd5d218bdb2e1387265e8c79a93571a68fc58bd408836bc34d8e |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 287245 | b3b5e1b1595a1b69a6f2b4ed3e05c1fb3b9348eee1e8e5908730b0af8561c7e4 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 604322 | 73ff63a3e46c7a2637017406f21808c4469d6cf09059ea8a2d6e2f3862ee4a80 |
| var/main-flow-demo-evidence/product-app.png | present | 277297 | 980ae8df8e197ec6bacff6b27b78a322a2a2ffea02b5d947d28344c866687d29 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 599788 | 51e1063a3c83cfa9b87130138c208fbbec223ec0c52d4e7f961bcc304435e9f2 |
| var/main-flow-demo-evidence/product-app-store.png | present | 195452 | 222014c7754c40aa59cc75a1d909c5e6106382b9733a51d4f91d4da6a461a68e |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 179710 | a017676a7e3b147c9a4fff48be69734b7ee98dff2214c1b45642a8b7188a34a4 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 213707 | b45986f24b7f0c4a17bcc8d06c48a2599e768b013830a0f66b49cbefc3254460 |
| var/main-flow-demo-evidence/product-app-finance.png | present | 212176 | 066cfb80d7014057019074bad6f4bf4c1518d2fababf34a9bec88a687681645b |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 193996 | 06930d0e5e4e1d4381ca1353962fb6359075e144abc6344872062bdadae60c12 |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 231486 | a98b6eae1f713d203b0a963bac714cca0edf0b0b47d6787601446d90042a1372 |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 236087 | b43c6bc99ef52e846ddc9460ce6e03be6601ca39a8579086a3d8271d923fc536 |
| var/main-flow-demo-evidence/product-app-finance-pending-action.png | present | 296056 | 040465a84b92a909b91f1991d79ddb83f4e065f33b5bf8bbcb02793eaa8aa155 |
| var/main-flow-demo-evidence/product-app-workflow-refresh-flow-action.png | present | 197297 | 58d1856b13c97c534e0e664e018e2c5695cd7a5fe9bdf7b7a2db82d53cb97582 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 216888 | 61c90af0d8e30fcbf33020d21b64a9ecc13748328d709471582934496584b63e |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 492089 | 2175e613417fdd103fec5d3de21985f1c24aed7a9857cc6cd2bae9b2f1ace3e8 |
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
