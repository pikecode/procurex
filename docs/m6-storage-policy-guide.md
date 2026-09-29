# M6 Storage Policy Guide

Last updated: 2026-09-29

This guide is the operator checklist for the `STORAGE_POLICY` blocker. It covers private payment evidence files: upload artifacts, downloads, retention, access review, backup policy, restore reference, and owner sign-off.

## Current Position

The application has local private-file behavior and download authorization checks. The intended production attachment bucket is now recorded as Alibaba Cloud OSS `moshuo-attachment-2026`, but the production private-file policy has not been signed. M6 must stay `NOT_READY` until the policy is complete.

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
