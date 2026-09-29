# M6 External Evidence Templates

Last updated: 2026-09-28

These templates define the shape of external launch evidence. They are examples, not launch approval by themselves. Real evidence should be reviewed, signed, and then recorded in the paths checked by `npm run m6:external-evidence`.

| Template | Target Evidence |
|---|---|
| `docs/m6-evidence-templates/wechat-device-manifest.json` | `var/m6-wechat-device-evidence/manifest.json` |
| `docs/m6-evidence-templates/production-runtime.json` | `var/m6-production-runtime.json` |
| `docs/m6-evidence-templates/production-storage-policy.json` | `var/m6-production-storage-policy.json` |
| `docs/m6-evidence-templates/production-recovery-drill.json` | `var/m6-production-recovery-drill.json` |
| `docs/m6-evidence-templates/production-initialization-signoff.json` | `var/m6-initialization-signoff.json` after customer finance sign-off |
| `docs/m6-evidence-templates/customer-pilot-run.json` | `var/m6-pilot-run.json` after customer pilot sign-off |

Use:

```bash
npm run m6:write-external-templates
npm run m6:check-external-templates
npm run m6:external-evidence
```
