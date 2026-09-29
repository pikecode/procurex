# M6 WeChat Device Evidence Guide

Last updated: 2026-09-29

This guide is the operator checklist for turning the M6 WeChat blocker from `BLOCKED` into `READY`. It only covers real-device mini-program evidence. Production server, domain, storage policy, finance sign-off, and customer pilot evidence remain separate blockers.

## Current Position

The experience members have been added, and the local `.env` can hold the real AppID plus test account identifiers. The production server and domain do not exist yet, so M6 must remain `NOT_READY` even after the WeChat evidence is complete.

Do not commit real-device screenshots, recordings, or secrets. `var/m6-wechat-device-evidence/` is intentionally ignored by Git.

## Prepare The Local Draft

Run:

```bash
npm run m6:prepare-wechat-evidence
```

This creates:

```text
var/m6-wechat-device-evidence/manifest.json
```

The draft should already include the configured `WECHAT_APP_ID` and role account identifiers. If account names need to be changed, update local `.env` and rerun the prepare command.

## Capture Real-Device Flows

Use the WeChat experience build on a real device. Capture screenshots or recordings for all three roles:

| Role | Test account | Evidence file |
|---|---|---|
| Store | `pxflow_store` | `var/m6-wechat-device-evidence/store-flow.png` |
| Supplier | `pxflow_supplier` | `var/m6-wechat-device-evidence/supplier-flow.png` |
| Purchaser | `pxflow_user` | `var/m6-wechat-device-evidence/purchaser-flow.png` |

The Store capture should show order creation and receipt confirmation. The Supplier capture should show shipment handling plus discrepancy or payment-related handoff. The Purchaser capture should show order confirmation and supplier rejection or reallocation handling.

If a recording is clearer than a screenshot, store the recording under the same directory and update `manifest.json` to point at that file path.

## Fill The Manifest

Edit `var/m6-wechat-device-evidence/manifest.json` locally and complete these fields:

| Field | Required value |
|---|---|
| `deviceModels` | Real phone model names used for acceptance |
| `bindingOperationMode` | The actual account binding mode used in the experience build |
| `checkedFlows` | Keep every required Store/Supplier/Purchaser flow marked present |
| `screenshotsOrRecordings` | Paths to the three real-device files |
| `subscriptionMessageResult` | `PASS` after subscription-message behavior is verified |
| `signedBy` | WeChat acceptance owner name |
| `signedAt` | Acceptance timestamp or date |

## Validate

Run:

```bash
npm run m6:check-wechat-evidence
npm run m6:external-evidence
npm run m6:readiness
```

Expected result after valid screenshots, subscription-message PASS, and sign-off:

| Output | Expected change |
|---|---|
| `npm run m6:check-wechat-evidence` | Passes locally |
| `apps/web/m6-external-evidence.json` | `WECHAT_DEVICE` changes to `READY` |
| `apps/web/m6-readiness.json` | DEV-602 WeChat item changes to `READY` |

M6 is still not production-ready until the production runtime, storage policy, production recovery, finance sign-off, and customer pilot blockers are also complete.

## Refresh Handoff Materials

After WeChat evidence passes, refresh the M6 materials:

```bash
npm run m6:capture-readiness-evidence
npm run m6:package-local-evidence
npm run m6:write-local-handoff
npm run m6:write-customer-evidence-request
```

Only commit generated public summaries and JSON outputs. Leave `var/m6-wechat-device-evidence/` local.
