# Viewing requests and appointment coordination

## Lifecycle and duplicate policy

1. A visitor signs in or creates an account before submitting a viewing request.
2. A request records the signed-in requester, contact details, preferred date,
   optional preferred time, and optional message.
3. An agent can confirm the requested date/time, propose or revise a date/time,
   reject an open request, cancel an active request, or mark a confirmed
   viewing complete after its scheduled time.
4. The customer can accept or decline an agent proposal, or cancel an active
   request. A declined proposal remains open for further scheduling.
5. Status and schedule changes are retained in request event history.

Only one active request per customer/property pair is allowed. `pending`,
`proposed`, `confirmed`, and `declined` are active; `rejected`, `cancelled`,
and `completed` are terminal. Appointment date/time values are local wall-clock
values in `Africa/Addis_Ababa`.

## Customer API

All routes below require the account's authenticated tab session. The numeric
request ID is not an authorization credential; reads and actions are scoped to
the authenticated requester.

- `POST /api/v1/viewing-requests/` creates a request for a published,
  available property. Repeated active requests return HTTP 409.
- `GET /api/v1/viewing-requests/mine/?page=1&status=proposed` returns the
  customer's paginated requests and event history.
- `GET /api/v1/viewing-requests/mine/{id}/` retrieves one of the customer's
  requests.
- `POST /api/v1/viewing-requests/mine/{id}/respond/` with
  `{"decision":"accept"}` or `{"decision":"decline"}` responds to an agent
  proposal.
- `POST /api/v1/viewing-requests/mine/{id}/cancel/` cancels an active request.

The React page is `/viewing-requests`; sign-in redirects retain the selected
property. Contact data can be prefilled from the account and reviewed before
submission.

## Legacy receipts and notifications

New guest requests are not accepted. The receipt endpoints remain available
only for eligible old records with a stored receipt-token digest. The raw
token is never stored in the database or placed in a URL. Notifications are
in-app only; no email or SMS notification provider is configured for viewing
workflow events.

## Agent API and schema

Approved agents have citywide viewing-request management access, consistent
with the current single-city agent workflow. Ownership or staff status alone
does not grant that access.

- `GET /api/v1/management/viewing-requests/` lists requests the agent can
  manage.
- `GET/PATCH /api/v1/management/viewing-requests/{id}/` reads details and
  proposes/revises a schedule or rejects an open request.
- `POST /api/v1/management/viewing-requests/{id}/action/` with
  `confirm_requested`, `cancel`, or `complete` performs the other agent
  transitions.

The Node backend expects a database with the established application schema.
It does not run Django or other schema migrations during startup. The former
Python migration instructions have been removed; back up and verify the
existing database before applying any separately reviewed SQL migration.
