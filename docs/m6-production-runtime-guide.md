# M6 Production Runtime Guide

Last updated: 2026-09-29

This guide is the operator checklist for the `PRODUCTION_RUNTIME` blocker. It is intentionally separate from WeChat real-device evidence, object-storage policy, recovery drill, finance sign-off, and customer pilot sign-off.

## Current Position

An SSH-accessible server is available as of 2026-10-08. The isolated deployment procedure and actual execution record are maintained in `docs/server-deployment.md`. A production domain/HTTPS and the remaining external sign-offs are not yet available. M6 must stay `NOT_READY` until the required runtime and external launch evidence is complete. The standalone worker is currently a placeholder; export maintenance runs in the API process.

## Required Inputs

| Input | Required shape |
|---|---|
| `DATABASE_URL` | Production PostgreSQL URL, not localhost, not `127.0.0.1`, not `procurex_local_only` |
| `PRIVATE_FILE_DIR` | Production private-file mount or object-storage service path, not `var/private-files` |
| `PUBLIC_API_BASE_URL` | Real HTTPS API domain, not `example.com` |
| `NODE_ENV` | `production` |
| `HOST` / `PORT` | API process binding for the production runtime |
| Worker process | `npm run start:worker` or equivalent process manager entry |
| Migration owner | One named operator runs `npm run db:migrate` once from one controlled shell |

## Preflight Command

Run after candidate production environment variables are available:

```bash
npm run m6:check-production-runtime
```

The command writes:

```text
var/m6-production-runtime.json
```

It masks database credentials in the report. It does not prove network reachability by itself; it proves the configured values are shaped like production runtime inputs and are not local placeholders.

## Promotion Path

1. Provision production PostgreSQL and private payment-evidence storage.
2. Configure the HTTPS API domain and TLS routing.
3. Set production env vars for API and worker.
4. Build the release artifact.
5. Run `npm run db:migrate` once from the migration owner shell.
6. Start API and worker.
7. Run smoke checks for login, order creation, receipt, statement, payment registration, private file upload/download, and worker-driven export or reminder tasks.
8. Run:

```bash
npm run m6:check-production-runtime
npm run m6:external-evidence
npm run m6:readiness
```

`PRODUCTION_RUNTIME` can become `READY` only when the runtime report is `READY` and the same environment also passes the external evidence check. M6 still remains `NOT_READY` until the other external blockers are complete.

## Do Not Commit

Do not commit `.env`, database credentials, private keys, TLS private material, or screenshots containing secrets. Commit only sanitized JSON reports and public handoff documents.
