# Local development

## Backend

The Node API requires Node.js 20 or newer and PostgreSQL. It uses the
established application schema; it does not initialize an empty database or
run migrations automatically. Use an existing development database, never a
production database, for local work.

1. Copy [backend/.env.example](../backend/.env.example) to `backend/.env`.
2. Set `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` for the
   development database. `DATABASE_URL` can be used instead.
3. From `backend/`, install dependencies and start the API:

   ```powershell
   npm ci
   npm start
   ```

The API listens on port `3000` by default. Local media paths can be set with
`MEDIA_ROOT` and `PRIVATE_MEDIA_ROOT`; the private path must not be web
accessible.

## Frontend

In a second terminal:

```powershell
Set-Location ..\frontend
npm ci
npm run dev
```

Vite proxies `/api` and `/media` to `http://127.0.0.1:3000` by default. Set
`VITE_API_PROXY_TARGET` in `frontend/.env.local` to override the API origin.
