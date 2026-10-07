# M6 Storage Policy Guide

Last updated: 2026-10-06

This guide is the operator checklist for the `STORAGE_POLICY` blocker. It covers private payment evidence files: upload artifacts, downloads, retention, access review, backup policy, restore reference, and owner sign-off.

## Current Position

The application supports local private files and an opt-in OSS adapter, preserving download authorization checks. The attachment bucket is Alibaba Cloud OSS `moshuo-attachment-2026`. Following RAM authorization on 2026-10-06, real uploads/downloads, byte/SHA256 comparison, anonymous OSS rejection (403), API authentication (401), unrelated-supplier rejection (404), and precise test-version cleanup passed. The local API at port 3114 now uses FILE_STORAGE=oss with OSS_PREFIX=procurex-test/. This is a test namespace, not production acceptance. Production policy is not signed; M6 remains NOT_READY.

## Adapter Configuration

Keep credentials only in the untracked local `.env` or server secret store. `FILE_STORAGE=local` is the default, including when OSS credentials exist. Set `FILE_STORAGE=oss` only after verifying RAM permissions and connectivity. Required fields: `OSS_BUCKET`, `OSS_REGION`, `OSS_ENDPOINT` (HTTPS origin), `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, and a non-empty `OSS_PREFIX` ending in `/`. Use `OSS_CNAME=true` only for a bound custom-domain endpoint.

New OSS metadata keys carry `oss:` plus the configured prefix and a UUID. Existing local UUID keys remain readable; there is no automatic historical migration. Do not change the bucket or prefix with existing OSS records without a migration plan. Downloads continue through the authenticated API; clients never receive OSS credentials or public object URLs. Storage errors propagate rather than marking files as invalid content, and failed cleanup retains database metadata for retry.

For local acceptance, restrict RAM object actions to the test namespace:

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["oss:PutObject", "oss:GetObject", "oss:DeleteObject"],
    "Resource": ["acs:oss:*:*:moshuo-attachment-2026/procurex-test/*"]
  }]
}
```

Attach this custom policy to the dedicated RAM user, not the root account. Deny policies can override it. This bucket has versioning enabled: ordinary deletion creates a delete marker and does not remove retained historical versions. The adapter does not purge versions or change lifecycle settings; production cleanup/retention acceptance must account for this. OSS's overwrite-prevention header is not effective on versioned buckets, so this header is not an atomic duplicate-upload guarantee. The acceptance script deletes only the exact version it uploaded and verifies it is missing before deleting its own database record; it does not bulk-list or purge existing objects.

Local cloud acceptance can be rerun with `node --env-file=.env scripts/check-oss-attachment.mjs` after building. To verify the running service, prefix the command with `OSS_CHECK_API=http://127.0.0.1:3114/api/v1`. The script refuses non-local databases/APIs and any bucket/prefix other than this test namespace. It uses demo accounts, performs login session writes and one unattached PAYMENT file session, and records sanitized evidence at `var/oss-attachment-evidence/manifest.json`. Current live-service verification: PASSED, cleanup PASSED; log `/tmp/procurex-oss-live-http.log`. It is not production policy, retention, or recovery acceptance.

## Required Evidence

Target file:

```text
var/m6-production-storage-policy.json
```

Run:

```bash
npm run m6:check-storage-policy
```

The command creates a `BLOCKED` draft when the target file is missing. Fill the draft with real production values, then rerun the command until `status` becomes `READY`.

## Required Fields

| Field | Required value |
|---|---|
| `signed` | `true` after operations/security approval |
| `owner` | Named storage policy owner |
| `storageProvider` | Production object-storage or private-file service |
| `privateFileRoot` | Production path, bucket, or service namespace, not `var/private-files` |
| `retentionDays` | At least 365 |
| `accessReview.roles` | Must include `ADMIN` and `HQ_FINANCE` |
| `accessReview.lastReviewedAt` | Review date |
| `accessReview.reviewer` | Reviewer name |
| `backupSchedule.frequency` | Backup cadence |
| `backupSchedule.retention` | Backup retention rule |
| `restoreTestReference` | Reference to production recovery drill evidence |
| `downloadAuditPolicy` | Must mention authenticated audit logging |
| `signedAt` | Sign-off date |

## Validation

Run:

```bash
npm run m6:check-storage-policy
npm run m6:external-evidence
npm run m6:readiness
```

Expected result after sign-off:

| Output | Expected change |
|---|---|
| `var/m6-production-storage-policy.json` | `status=READY` |
| `apps/web/m6-external-evidence.json` | `STORAGE_POLICY` changes to `READY` |
| `apps/web/m6-readiness.json` | DEV-603-STORAGE changes to `READY` |

The policy alone does not prove recovery. The production recovery drill still needs `var/m6-production-recovery-drill.json`.
