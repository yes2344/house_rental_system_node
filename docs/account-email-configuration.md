# Account verification and password recovery email

The Node backend sends account verification and password-reset links through
SMTP. Set `FRONTEND_URL` to the frontend's origin so links point to the correct
site. Production requires an HTTPS frontend URL.

## Local development

Copy `backend/.env.example` to `backend/.env`. Configure `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, and `FRONTEND_URL` to use
an SMTP provider. Email delivery is not simulated locally; an unconfigured or
unavailable SMTP service causes email operations to return an error.

## Production

Set these variables in the backend host's private environment configuration:

```dotenv
SMTP_HOST=<provider-smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<provider-username>
SMTP_PASS=<provider-password>
EMAIL_FROM=<verified-sender@example.com>
FRONTEND_URL=https://your-frontend.example
```

Use the port and TLS settings required by your provider. Never put SMTP
credentials in frontend variables or commit them to Git. `FRONTEND_URL` must
be an HTTPS origin without a path, query, or fragment in production.

Email verification, resend, and password-reset request endpoints are
rate-limited. Reset-request responses intentionally do not disclose whether
an account exists. Frontend links are `/verify-email`, `/forgot-password`,
and `/reset-password`.

The Node backend uses the existing PostgreSQL application tables; it does not
run database migrations during startup. Back up the database before applying
any separate migration.
