# Account Management Acceptance

## Implemented

- Administrator: create database-backed accounts; edit display name, status, role and store/supplier binding.
- Existing multi-role accounts remain unchanged unless an administrator explicitly selects a replacement role.
- Role and scope must match; new bindings require an active store or an active, non-archived supplier.
- Administrators cannot disable themselves or remove their own administrator role. At least one active administrator must remain.
- Administrator changes are serialized in PostgreSQL to protect against concurrent administrator demotions.
- Reset passwords and revoke all sessions from user-list actions. Reset requires the displayed account version.
- All authenticated roles can change their own password with current-password verification through `POST /auth/password`.
- Password changes, permission changes and disabling revoke old sessions. Re-enabling does not restore revoked sessions.
- Login session issuance checks account changes inside the same database lock used by account maintenance.
- User-list filters cover role, status and business entity. Creation time, most recent retained login-session creation time and recent audit records are available.
- Password values and hashes are excluded from user responses and account audit entries.
- User changes record before/after display name, status, roles, scope and version in the same transaction. The user-list audit dialog can expand these details; historical metadata-only entries are not reconstructed.
- Administrator menus and direct page access use the same explicit page whitelist. Unknown roles and unbound store/supplier roles cannot enter company pages.

## Fixed Role Boundaries

Roles are maintained in the database and assigned in user management. Business permissions remain explicit server-side rules, not configurable checkboxes. This change does not introduce custom roles or alter approved business permissions.

| Operation | Administrator | Purchaser | Company Finance | Store | Store Finance | Supplier |
| --- | --- | --- | --- | --- | --- | --- |
| Account/role/password administration | Yes | No | No | No | No | No |
| Store/group maintenance | Yes | Read | Read | No | No | No |
| Product/supplier/template maintenance | Yes | Yes | Read products/suppliers | No | No | No |
| Place orders | Yes | Yes | No | Own store | No | No |
| Confirm procurement | Yes | Yes | No | No | No | No |
| Ship/reject supplier orders | Yes | No | No | No | No | Own supplier |
| Receive shipments | Yes | No | No | Own store | No | No |
| Recharge/credit-limit/clearing administration | Yes | No | Yes | Read own account | Read own account | No |
| Register/cancel payments | Yes | No | Yes | Own scope | Own scope | No |
| Confirm/reject payments | Yes | No | Yes | No | No | Own scope |
| Profit report/export | Yes | Yes | Yes | No | No | No |
| Order/quantity report/export | Yes | Yes | Yes | Own scope | Own scope | Own scope |

Payment and document operations additionally enforce settlement direction, participant, document status, version and idempotency. A role alone does not make every record actionable. Export jobs are restricted to the requesting user and their current permitted scope. Private voucher access requires ownership, a matching linked business document or central finance permission.

## Local Verification

`scripts/check-local-user-management.mjs` uses only real local business APIs and database persistence, not direct database fixtures. It receives existing administrator credentials and the acceptance password through environment variables, never credential files.

Coverage: password-reset authorization and stale versions; invalid current password; old-password rejection; multiple-session revocation; invalid scope; company-role and store-binding changes; self-disable protection; disable/re-enable behavior; audit redaction.

The one-off acceptance account is retained and disabled after a successful run. No existing business accounts have their passwords or permissions changed.

Unit tests additionally cover last-administrator and self-demotion protection. Production build and administrator type checking must pass.

`scripts/check-local-role-permissions.mjs` verifies six roles using real accounts created through the local API. It covers allowed/denied reads, forbidden writes including forged actor/role fields, store and supplier order isolation, report-filter isolation, private voucher upload/download, export ownership and role-change audit details. It creates eight one-off accounts and disables them in cleanup. Credentials are supplied through environment variables; no database fixture writes are used.

The script accepts `LOCAL_API_BASE` only for `http://127.0.0.1:<port>/api/v1`. A successful run completed 126 checks. The updated local API runs on port 3114 and the existing administrator preview remains on port 4174. No server deployment was performed.

## Remaining Work

- First-login mandatory password change, including native mini-program UI and restricted-session enforcement.
- Persistent login-attempt throttling/temporary lockout and login-failure audit.
- Native mini-program change-password entry (the authenticated API is available).

These items are not implied by the completed local acceptance. Server deployment is separate.
