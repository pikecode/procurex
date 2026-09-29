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
| Packaged commit | 1bd60e43aaf443f61e7a02aeb67066bcb30cc773 |
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
| apps/web/m6-readiness.json | present | 4956 | d85388db932176ef535d39e4f8e7751fa3fe023ab44ae8f0b7ed53272065d519 |
| apps/web/m6-external-evidence.json | present | 5044 | 2dc37b094ddf19ec1fc1ec7fd98cae803713e2b3ce3826d96cdddf42f0a8b7c7 |
| var/m6-external-evidence.json | present | 5044 | 2dc37b094ddf19ec1fc1ec7fd98cae803713e2b3ce3826d96cdddf42f0a8b7c7 |
| var/m6-performance-report.json | present | 2502 | ef810f1d3c8971f25c81655682576cf9f1408dc33b3c8c1af7fb87bbd4c92838 |
| var/m6-rollback-drill.json | present | 4421 | 6d5028efb0082f04e1473b200e973e5d97758bf23a906d5fb44d0c15fb5d3296 |
| var/m6-initialization-signoff.json | present | 4806 | 95f3ba32a422fdaad43a0b7f7a171b6b31bd3f6b83addc293f100e60bea2ce28 |
| var/m6-pilot-run.json | present | 4557 | 66abf81a69e53e2c0944787bf82481eef0b8ed2edf49e889e2c18027529377b1 |
| var/m6-readiness-evidence/manifest.json | present | 2183 | 6dc537654da2f92c9b82bffa328dea433e5eac0e80cf51df33b7b37a74200173 |
| var/m6-readiness-evidence/m6-readiness-desktop.png | present | 457466 | 2b42648889d5b3b6ad2b5e3c6d2e426270863c5b5373240202c0a2458328cdff |
| var/m6-readiness-evidence/m6-readiness-mobile.png | present | 1196966 | 42d28d9749d5556bf96d16f07155e641eeb2d11b3c1aaaf79bd291c922e56b70 |
| apps/miniprogram/mini-flow-check.json | present | 2428 | 23643a107e2f2b280af4f96d33441fb665fddbfe0b79d522371c8d9d5b61cc76 |
| apps/web/m5-gate-status.json | present | 2122 | 2ec4c95ed2daf2b4e9ab847a6844d6d8cc18dc6ffe6613be871e0f26c70a2e71 |
| apps/web/app.html | present | 348 | 59df6ba85c82b57bd2ded02b2e7536648939df873ef971a301343e4120c2f1ef |
| apps/web/product-app/main.js | present | 890 | 67961857fe7fc248fac55ba55144220c45ddaa2b8c60493c58ec1e1c6762e1ed |
| apps/web/product-app/api.js | present | 1017 | 482f25633a22f71b2eb87e0cc7d1a843bcea3ed2e70ad6e028b5e91ffde89f99 |
| apps/web/product-app/shell.js | present | 2736 | 9b19dbe53f3f8bb3bf6ee60427c38b721791ae705c96e01be103c489b31ce5ef |
| apps/web/product-app/workflow.js | present | 2622 | 497b482ff9159cc6db8a35f5fe32be54f15f7a68d48fb2d72a36249a29cf18d0 |
| apps/web/product-app/pages/overview.js | present | 10199 | 21dd1950d97b1c3a7ea479d8cf8c1a0fb5b606ed709ea4111963dce86b42eac0 |
| apps/web/product-app/pages/flow.js | present | 21328 | e3524342871651102135cb0cb2ef4c7bb47669f6754048fc53b4e29f8c077d6a |
| apps/web/product-app/pages/store.js | present | 10818 | 8a6e9aa976929760bfb67e1461eb5e13e8d93d66dc238e099f931bdcad5675de |
| apps/web/product-app/pages/purchaser.js | present | 11746 | ec9156e0e4e71e77713baa690370437787c951bb26fe43a7d7b67a9feca3b242 |
| apps/web/product-app/pages/supplier.js | present | 16952 | 952530617f170b98054df0ea0e1367b18ec6de4460391525141252d56dd77769 |
| apps/web/product-app/pages/finance.js | present | 20356 | 0e115389dd6d01a795b39e4b8b2102674bececedda92fcbc8684c089d3e79d43 |
| apps/web/store-workbench.html | present | 5087 | 8249ddfc1c8aef3aa39c8a317b0cf1045606745f650d81dda1b1bba6861394f1 |
| apps/web/store-workbench.js | present | 12781 | f080b77ef468843c8a5d5d826f2498d912744b26bc650060c0825f773fe30373 |
| apps/web/purchaser-workbench.html | present | 4684 | 2751a93801cbdbc1099f4fa77ca44ade6ead42807b1ce685e2d695a9abdb419f |
| apps/web/purchaser-workbench.js | present | 10935 | 7c796b92f05e8459c54e1e00ea0a9380c0434705df366758a1848f14996bf660 |
| apps/web/supplier-workbench.html | present | 6300 | b89ba3341469a6a9ce37742c03610a038ddd594763672ddca921d16ba43da658 |
| apps/web/supplier-workbench.js | present | 15424 | 4913cea43201584a6da807cf64f757155eab5b3148d037c2f350f9f557ad442d |
| apps/web/m7-business-flow.html | present | 2942 | 7a3170e3e54be514b8be6ede23c043113bc42c98493f858445e192ee7e078c13 |
| apps/web/m7-business-flow.js | present | 8187 | c98f1d41f64fe0b80437c5101ab4be7b416d7188df0d2f7a136aeee2ff5ff7ee |
| var/main-flow-demo-evidence/interactive-manifest.json | present | 38526 | c580cafb7f35181923241d82ef323257eee19ce90355209e3ce424ada048a567 |
| var/main-flow-demo-evidence/store-workbench.png | present | 238787 | 2e503fe4f6b0b6bb4c286ec337e5291822706168e2013d6c0798912b7f824d40 |
| var/main-flow-demo-evidence/store-workbench-mobile.png | present | 503546 | d7ca7a2a5bb877b52fa0448504023b1248e699a1b9338a6223077ac7b40d4545 |
| var/main-flow-demo-evidence/purchaser-workbench.png | present | 226122 | a36478c25e1aa224015006e9b712ffd51a6acab7b4edeaa67aa3a166ad4012e0 |
| var/main-flow-demo-evidence/purchaser-workbench-mobile.png | present | 454297 | 90dc36cb38780a8bd5289ddc935f4ea3a2a6cdd397c176224f0d55bca36f91ed |
| var/main-flow-demo-evidence/supplier-workbench.png | present | 291971 | 5de27e1ff411188daa01be388e5b19663484de8ae6c0049c127d0f59e6dc032b |
| var/main-flow-demo-evidence/supplier-workbench-mobile.png | present | 607247 | 9150968914ce51b923c1ab8922448da09bfae562dc6b5858d5ac534d51a266a8 |
| var/main-flow-demo-evidence/product-app.png | present | 277575 | 085e370bd65c534074d63ff738ef08c0ab688b93c927823de5ed6e5b93af3074 |
| var/main-flow-demo-evidence/product-app-mobile.png | present | 600545 | 4eedf6029c295eda5d57a20bf174e8ca5f35d6787448885feb790bab0b2ba14d |
| var/main-flow-demo-evidence/product-app-store.png | present | 200765 | 99dc61e636ebbfc731dd46e5e30574ebaac0f29884f65b1c9e716ccdbbd8b0ac |
| var/main-flow-demo-evidence/product-app-purchaser.png | present | 183744 | 0038c96018e7e75adc0375bcfb07dbea968d03a70fecdaacbc360dd5d967e550 |
| var/main-flow-demo-evidence/product-app-supplier.png | present | 221048 | cfe6b1150ad6b4375d5fa2c4e7324c2a79f7abc8a9c14d555aadc5ff2fa9c4c0 |
| var/main-flow-demo-evidence/product-app-finance.png | present | 213358 | e9f7f399b3ca1c0c39084d8c8c3c3b78e01586f55b553bcd999a746c1b7a3b9a |
| var/main-flow-demo-evidence/product-app-flow-action.png | present | 197158 | cbe4dc44994d10e7f6b0ca48dba0b0666dec8bcc31c3f7aeba1ad24fc1c6b26a |
| var/main-flow-demo-evidence/product-app-finance-reject-action.png | present | 233043 | 29f2a129e2bb1a3ac86016ed4df01728ec5061eec7b0d97ba884593d72b2a676 |
| var/main-flow-demo-evidence/product-app-finance-action.png | present | 237209 | c343a5d885d61de29cbc8819ec17d440b6ca9bb858f2ecb60706ca0d8518adc6 |
| var/main-flow-demo-evidence/product-app-finance-pending-action.png | present | 289687 | 6e7fc982a5bd8293c5ebdfd5ca42d64d0af8b434669fb487a36f0e83f1cffca6 |
| var/main-flow-demo-evidence/product-app-workflow-refresh-flow-action.png | present | 195455 | 739f0b65e4ff34e3513e4314c8932ca235c792a6558ad91e8541fa7ed16632d5 |
| var/main-flow-demo-evidence/product-app-supplier-discrepancy-action.png | present | 288154 | d8741b7fd32c347bba2d1361e8a7fc52f23b4c15b6bd82db47dd1c205839c18b |
| var/main-flow-demo-evidence/product-app-role-mutation-journey.png | present | 289283 | bb15b57d721021abfe6385e8eff5e621d2e5cc05de1cb26c31a796674df640a9 |
| var/main-flow-demo-evidence/product-app-role-mutation-journey-mobile.png | present | 273526 | 520c92fb6c165dbc9503db2cc457950549fa1868096e969daf630d2645ffc22c |
| var/main-flow-demo-evidence/m7-business-flow.png | present | 217111 | 50df0aa05541b3387b22bfcb726521e62650f419509497a9dc8414576d0c2380 |
| var/main-flow-demo-evidence/m7-business-flow-mobile.png | present | 491940 | 660a87a86500d1024de22377f5295429d467a47a38aaec7ceb2890a6fa00a187 |
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
