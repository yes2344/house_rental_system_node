# Tab-scoped SPA authentication

The React application uses an independent API session for each browser tab. A
successful login issues a random bearer token, stores only its SHA-256 digest
in PostgreSQL, and returns the plaintext token once to the browser. The SPA
keeps that token in `sessionStorage` and sends it as an `Authorization: Bearer`
header. The token expires after 14 days; signing out revokes only the token
for the current tab.

The Node REST API authenticates requests with these bearer tokens rather than
a shared server-rendered browser session. The login endpoint also requires
CSRF validation. The frontend obtains a CSRF token before login and sends it
with the login request.

The Node backend expects the established account tables to exist in
PostgreSQL. It does not apply schema migrations automatically at startup.
