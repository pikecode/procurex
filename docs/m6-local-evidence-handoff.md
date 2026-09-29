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
| Packaged commit | ce03d1ef3eae04cd8f63f124d991d328b47aec5b |
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
| apps/web/product-app/main.js | present | 890 | 67961857fe7fc248fac55ba55144220c45ddaa2b8c60493c58ec1e1c6762e1ed |
| apps/web/product-app/api.js | present | 1017 | 482f25633a22f71b2eb87e0cc7d1a843bcea3ed2e70ad6e028b5e91ffde89f99 |
| apps/web/product-app/shell.js | present | 2615 | aedc4bd5794c707b8cf72348116ac5fa5c412cd851ab52ba1a590e310fe2d413 |
| apps/web/product-app/pages/overview.js | present | 2571 | 3a5c8921c6e973086c207a9fa236979b1f36232193f57d9fc339f0c5e71f3ffb |
| apps/web/product-app/pages/flow.js | present | 18618 | 03e83179acd04f45b0c523355438cc3763ae3b288bf305f991ac2883a43ecacd |
| apps/web/product-app/pages/store.js | present | 5577 | 5bfeda292f7778872b6ef62bdfada6887c57e9343f0885b22de1fbad5009f544 |
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
| var/main-flow-demo-evidence/interactive-manifest.json | present | 27733 | 6ea07657ec486010f47fbe21a5f5dc372d44c9eb583747cdbccf3de2a27cb745 |
| var/main-flow-demo-evidence/store-workbench.png | present | 236684 | c5884e935836556ea59ec9c91628d507e2b9639aad795afa832ae3ea5b54c64c |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 502103 | a255748f1d9f4c621afb11fb00c8ad2d615572c9c64f03ac43ad9a98f7041294 |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 223332 | d5ba97b6f1ef0ca8a2dfb465d6caabdf515644faa1939dad41daed854924427d |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 454517 | d59d9320b4e7451cbd96cb6e9cd2dad59a8cac03d65e462e3c5411094dca8a4b |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 288396 | 65c2e69a8f9df0012f5e7219d0cb591bb92178e5175bcc8acf2fe74cf4d270b8 |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 607983 | 9d249144d5ed4a10a929d830e74c6845b903099318f868aeb742a474dca60692 |
| var/main-flow-demo-evidence/product-app.png | present | 130603 | 00761858f9e625e1d709ef6f808bf8018e7b28b62c03e657b632dcf081e5cf5c |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 278396 | 15e292b98f58b8b0a00ea1f7f0e845f52d4d6127d08512bbcf07d3da468c6d45 |
| var/main-flow-demo-evidence/product-app-store.png | present | 167625 | 1d9d386493af7841dd46fe93ae11839a5cde92a5000ddd38af48bca724671ffe |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 165669 | 833b36e2aaf4e5fbc422e99119243f55b7331227d358b59c1aeba8dfb4516cab |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 204037 | 11c55bd4fb93c8502d72b1096b1810c3b6d01ebc31f6de69c9422df3ec733e4a |
| var/main-flow-demo-evidence/product-app-finance.png | present | 179800 | 2abd4149a6b54a43a8442553db4540bd32c2a787f33d696939e8324e990c92c6 |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 163671 | 8615498f373a2704a654e10e7ab86a1c11ef49a27246e83bcf07c25599170838 |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 184148 | 92e8e96de562c9b9ed587b0ef6d936eb6340e63be4fdbe61c612b6a172e6b15b |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 188632 | 0318803b3a2a61588405b3cccf95806964d9e0cd80e8021eeb1995dfe91cfaa6 |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217421 | fd55ecb2d6d0ccf80b76f11a8ff09acb0d1457fb6f29b5023f065f84a124e8c2 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 491130 | 68c3f794da673e3b1732863739412289d5231c6095cd75ac37786312e7fab103 |
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
