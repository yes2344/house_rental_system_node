# HahuCloud deployment

This guide covers a static React/Vite frontend and the Node.js API. Before
deploying, confirm that your hosting plan supports a persistent Node.js 20+
process, PostgreSQL connectivity, and writable persistent media directories.
If the plan only supports Python/Passenger applications, it cannot run this
Node backend; do not upload the removed Django application as a substitute.

## 1. Prepare the host

1. Point the main domain and an API subdomain (for example, `api.example.com`)
   at the hosting account and enable HTTPS for both.
2. Create or identify the PostgreSQL database and application user. The Node
   API expects the existing application tables and records; it does not
   initialize an empty database or run migrations during startup. Back up
   the database before deployment.
3. Create persistent directories for public and private media outside the
   deployed application directory. The private directory must never be
   served as a public or static directory.
4. Confirm Node.js 20 or newer is available and determine how the control
   panel starts and restarts a long-running Node application.

## 2. Deploy the API

Upload the contents of `backend/` into a directory outside the public web
root. Install dependencies in that directory and configure the application
entry command as `npm start`. Use the host's environment-variable settings
for secrets; alternatively, use a protected, ignored `backend/.env` file.

Configure the backend using [backend/.env.example](../backend/.env.example). Required database
settings are either `DATABASE_URL` or `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, and `PGPASSWORD`. Also configure:

- `NODE_ENV=production`
- `FRONTEND_ORIGINS` and `CSRF_TRUSTED_ORIGINS` with the exact HTTPS frontend
  origins
- `MEDIA_ROOT` and `PRIVATE_MEDIA_ROOT` with the persistent directories
- `FRONTEND_URL` with the frontend HTTPS origin
- SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and
  `EMAIL_FROM`) for verification and password-reset email

The host may supply `PORT`; the API listens on it. Do not set `PGSSL=true`
unless required by the database provider. Do not place the private media
directory inside the public web root.

Before switching traffic, run `npm run check:deployment` from `backend/` with
the production environment configured. This is a read-only readiness check;
it requires a database schema compatible with the Node backend, writable
persistent media directories, and configured email delivery. The backend
does not automatically apply database migrations. Review and back up before
running any explicit migration.

Check `https://api.example.com/api/v1/health/`,
`https://api.example.com/api/v1/properties/`, and
`https://api.example.com/api/v1/auth/csrf/` before publishing the frontend.

## 3. Build and upload the frontend

On a development machine, set the API base URL and build:

```powershell
Set-Location ..\frontend
$env:VITE_API_BASE_URL = "https://api.example.com/api/v1"
npm ci
npm run build
```

Upload the **contents** of `frontend/dist` to the main domain's document root,
including the generated `.htaccess`. Do not upload `.env` files,
`node_modules`, or the development source unless you need them for a separate
workflow.

## 4. Verify the live site

1. Confirm HTTPS works for both domains and the frontend can call the API.
2. Test listing search, property details, images, registration/login, an owner
   submission, and a viewing request.
3. Upload a property image and confirm it remains available after restarting
   the Node process.
4. Confirm private original images are not publicly accessible and that
   backups include PostgreSQL plus both media directories.
5. Test a restore of the database and media backup before relying on it.

Never run a database migration against live data without a verified,
restorable backup.
