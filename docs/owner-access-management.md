# Owner and delegated account management

## Administrator access

Customers, owners, agents, and administrators use the React sign-in page.
After sign-in, `/dashboard` shows actions allowed for the account. Protected
pages and API operations enforce permissions in the Node backend; hiding a
dashboard link is not an authorization control.

The backend uses the existing PostgreSQL account records. The guarded
Platform Owner bootstrap refuses to create an account if an active
administrator or superuser already exists. First configure `PLATFORM_OWNER_USERNAME`,
`PLATFORM_OWNER_EMAIL`, and a strong `PLATFORM_OWNER_PASSWORD` (at least 16
characters) in the private backend environment. Run a dry run first:

```powershell
Set-Location backend
npm run bootstrap:platform-owner
```

Only after reviewing the dry-run result, explicitly confirm account creation:

```powershell
$env:PLATFORM_OWNER_BOOTSTRAP_CONFIRM = "create-platform-owner"
npm run bootstrap:platform-owner -- --apply
```

The apply operation is transactional and rechecks the database state. It does
not reset or replace an existing account. A separate `bootstrap:siteadmin`
command can promote only a pre-existing `siteadmin` account; it also requires a
dry run, a separate confirmation value, and a password of at least 16
characters. Do not use either bootstrap command to overwrite an existing
administrator.

## Manage agents

Administrators can use **Manage agents** from `/dashboard` to create, inspect,
update, or deactivate agent accounts. Agent management is not a way to manage
customers or other administrators. New agent accounts follow the onboarding
workflow and are subject to approval before receiving management access.

Approved agents receive operational permissions for assigned properties,
viewings, and sub-city locations. The Platform Owner may separately grant an
approved agent `settings.manage` or `announcements.review_assigned` where
appropriate. Other administrators and agents cannot grant those permissions.

## Permission and account behavior

The Node API checks the active account and its role/permissions on each
protected operation. Property ownership or a prior listing submission alone
does not grant management access. Owner-announced listings require an
approved submission and active agreement; agent-managed listings must meet
their publication and availability requirements.

Deactivating an account revokes its active tab sessions. Account and
permission changes are written to the audit log without recording passwords.

## Verification

From `backend/`, run the configured test suite with `npm test`. Do not run
database migrations against production without a verified backup and an
approved deployment plan.
