# Non-functional requirements audit

## Scope and scoring

This assessment is based on the repository state at commit `6b4ef4f`, before
the NFR improvement in this audit. It is a source-and-local-check assessment,
not a production certification. The attached audit prompt is read-only and was
not modified.

This is a historical assessment of the former Django implementation. It does
not assess or certify the current Node.js backend.

Each category is rated from 0 to 5:

- **0**: absent or demonstrably unsafe.
- **1**: ad hoc, with substantial unmitigated risk.
- **2**: partially implemented; important controls or evidence are missing.
- **3**: implemented with meaningful local evidence, but not fully measured.
- **4**: robust implementation with repeatable verification.
- **5**: production behavior is measured against targets and actively monitored.

Weighted points are `category weight × rating ÷ 5`. An unmeasured production
property is not treated as proven merely because the code has a relevant
setting or feature.

## Baseline assessment

| Category | Weight | Rating / 5 | Weighted points | Evidence and main gap |
|---|---:|---:|---:|---|
| Security and privacy | 20% | 3.5 | 14.0 | Session authentication, role/object permissions, password validators, throttling, CSRF middleware subclass, upload validation, and opaque guest-request receipt tokens are present. The production check reports a CSRF-middleware warning because the configured middleware is a subclass rather than Django's exact built-in path; CSRF-specific tests and production proxy/TLS configuration still need explicit verification. No independent vulnerability scan was run. |
| Reliability and data integrity | 15% | 3.5 | 10.5 | Database constraints, transactions, idempotent agreement-expiry notifications, and regression tests exist. No production recovery, availability, or failure-injection evidence is available. |
| Performance | 12% | 3.0 | 7.2 | Public results are paginated, indexed, and prefetched. Baseline Vite build emits a 544.88 kB main JavaScript chunk (158.16 kB gzip), above Vite's 500 kB warning threshold. No representative load test or production latency measurement exists. |
| Usability and accessibility | 12% | 2.5 | 6.0 | Responsive layouts, skip-to-content, reduced-motion preferences, and accessible labels exist in parts of the UI. No automated accessibility scan or keyboard/screen-reader audit was run. |
| Maintainability | 10% | 3.0 | 6.0 | The backend is divided into domain apps and the frontend into pages, components, and API modules. Production-oriented Django checks report OpenAPI schema warnings that reduce confidence in generated API documentation. |
| Testing | 8% | 3.0 | 4.8 | Backend regression suites exist across the main apps. The frontend has no declared test or lint script; coverage has not been measured. The initial full-suite attempt encountered a pre-existing PostgreSQL test-database name collision, so no existing database was deleted or reused. |
| Scalability | 7% | 2.5 | 3.5 | PostgreSQL support, pagination, indexes, and a PostgreSQL-backed production cache option are configured. There is no load, concurrency, or deployment-capacity evidence. |
| Compatibility | 5% | 3.0 | 3.0 | TypeScript production compilation and a Vite production build are available. Supported browser/device versions have not been exercised. |
| Observability | 4% | 1.5 | 1.2 | Django and server processes can emit default diagnostics, but the repository has no configured structured application logging, error monitoring, dashboards, or alert thresholds. |
| Backup and recovery | 3% | 1.0 | 0.6 | Deployment documentation advises a database backup before migrations. Automated backup policy, media backup, retention, and a successful restore drill are not present in repository evidence. |
| SEO | 2% | 2.5 | 1.0 | The SPA has a document title and description, but route-specific crawlability and structured metadata have not been verified. |
| Localization | 2% | 3.5 | 1.4 | English and Amharic message catalogs and localized location labels exist. Translation completeness and formatting behavior have not been audited end-to-end. |
| **Baseline total** | **100%** |  | **59.2 / 100** | **Below the requested 80/100 target; not release-ready on available evidence.** |

### Baseline commands and results

- `frontend`: `npm run build` — passed TypeScript compilation and Vite build;
  emitted the 544.88 kB JavaScript chunk warning.
- Repository root: `manage.py check` — passed with no issues.
- Repository root: `manage.py check --deploy` with temporary non-secret
  production-mode environment values — reported 18 warnings: OpenAPI
  introspection/enum warnings and deployment security warnings. The HSTS
  subdomain/preload recommendations must only be enabled after confirming all
  relevant hostnames use HTTPS.
- Repository root: initial `manage.py test` — stopped safely because the
  configured PostgreSQL test database already existed. It was not dropped.
- Initial isolated baseline `manage.py test` with
  `DATABASE_URL=sqlite:///:memory:` (not the required production database
  engine) — 141 tests ran; 138 passed and 3 failed on stale expectations: a
  removed legacy admin viewing route, a test treating an approved agent's old
  stored permissions as effective, and expecting 403 where the scoped endpoint
  intentionally returns 404 for an out-of-scope owner-announced property. The
  intended access behavior was verified in code and the affected expectations
  were updated; all three focused regression tests then passed.
- No production traffic, load, accessibility, browser-compatibility, uptime,
  or backup-restore measurement was available.

## Measurable acceptance targets

The following targets distinguish local code checks from evidence that needs a
staging or production environment.

| Category | Acceptance target |
|---|---|
| Security and privacy | All authentication, CSRF, authorization, upload, and guest-token regression tests pass; no unresolved high/critical findings in a dependency/security scan; production TLS/proxy settings are verified against the actual ingress. |
| Reliability and data integrity | Full backend tests and migration-drift check pass; critical write workflows remain transactional; recovery objectives are documented and exercised. |
| Performance | Initial JavaScript is at most 120 kB gzip; largest route chunk is at most 300 kB raw; under 50 concurrent browse users with representative data, API p95 is below 500 ms and error rate below 1%. |
| Usability and accessibility | Core browse, listing, viewing-request, and agent workflows pass keyboard-only checks; automated scan finds zero critical/serious WCAG 2.2 AA violations; layouts are manually checked at 360 px, 768 px, and 1280 px widths. |
| Maintainability | TypeScript production build and Django checks pass; migration drift is zero; generated OpenAPI schema has no unresolved introspection warnings. |
| Testing | Full backend suite passes from an isolated database; critical backend workflow coverage is at least 80%; frontend critical-route behavior has repeatable automated tests. |
| Scalability | PostgreSQL staging load test sustains the agreed 50-concurrent-user profile without query growth per result row, p95 above 500 ms, or error rate above 1%. |
| Compatibility | Core flows pass on the latest two stable releases of Chrome, Edge, Firefox, Safari, plus current Android Chrome and iOS Safari. |
| Observability | Production emits structured request-correlated errors and exposes monitored latency/error-rate dashboards with actionable alerts and an on-call owner. |
| Backup and recovery | Encrypted daily database and media backups meet RPO ≤ 24 hours; a quarterly restore drill meets RTO ≤ 4 hours. |
| SEO | Public routes provide correct route-specific title, description, canonical URL, crawlable content, and validated structured data where applicable. |
| Localization | All user-visible public and agent workflows have reviewed English and Amharic strings; Ethiopic text, dates, numbers, and ETB formatting pass UI checks. |

## Improvement performed in this audit

The baseline build shows that all page modules are downloaded with the initial
application bundle. Route-level code splitting is the narrowest change that
directly addresses that measured issue without changing page behavior.

Database configuration now uses PostgreSQL in all environments, rejects
SQLite database URLs, and supports an optional `POSTGRES_TEST_DB` name so test
runs can use a separate disposable PostgreSQL database instead of the existing
test database.

All Debre Markos brand, page-copy, and demo-template references were changed to
Addis Ababa, including the Amharic labels and frontend package identity.
Unverified demo roads were removed rather than replaced with invented
street names. The default map center is the Addis Ababa city point returned by
OpenStreetMap Nominatim (9.0358119, 38.7524315). `Africa/Addis_Ababa` remains
unchanged because it is Ethiopia's correct IANA time-zone identifier.
Coordinate-related API and rendered-page test fixtures were updated to the
verified city point.

After the database and location changes, the full backend suite passed all 141
tests on a disposable PostgreSQL test database (341.460 seconds), and the
frontend production build passed. The repository-wide text search found no
remaining Debre Markos branding, old demo coordinates, or former package and
asset names. Addis Ababa terms and the correct Addis timezone are retained.

## Post-change reassessment

Route-level lazy loading reduced the largest/entry JavaScript chunk from
544.88 kB (158.16 kB gzip) to 395.90 kB (125.87 kB gzip), a 27.3% reduction in
raw size and a 20.4% reduction in gzip size. Vite no longer reports a chunk
over its 500 kB warning threshold. The largest separate map chunk is 163.08 kB
raw. The entry chunk alone is 125.89 kB gzip, missing the predeclared 120 kB
initial-JavaScript target by 5.89 kB; route dependencies add additional
first-screen chunks, and total cold-load transfer has not been measured.

The 141-test Django suite passes in 392.242 seconds using a separately named,
disposable PostgreSQL test database, which Django removed at suite completion.
Three stale test expectations were corrected to match the documented/current
behavior, and the three affected tests passed independently before the full
rerun. The existing PostgreSQL test database was not reused or deleted. The
normal project configuration was also verified to connect to PostgreSQL;
setting a SQLite `DATABASE_URL` causes Django startup to fail with an explicit
configuration error.

`manage.py check` passes, `makemigrations --check --dry-run` reports no model
drift, and `git diff --check` passes. The production-mode deployment check
still reports 18 warnings, including OpenAPI introspection/enum warnings and
deployment-only HSTS recommendations. Its CSRF warning is due to the custom
middleware subclass not matching Django's exact built-in middleware path;
CSRF-specific regression tests passed in the full suite. HSTS
subdomain/preload settings should only be enabled after confirming all
relevant hostnames use HTTPS.

| Category | Weight | Final rating / 5 | Weighted points |
|---|---:|---:|---:|
| Security and privacy | 20% | 3.5 | 14.0 |
| Reliability and data integrity | 15% | 3.5 | 10.5 |
| Performance | 12% | 3.5 | 8.4 |
| Usability and accessibility | 12% | 2.5 | 6.0 |
| Maintainability | 10% | 3.0 | 6.0 |
| Testing | 8% | 3.5 | 5.6 |
| Scalability | 7% | 2.5 | 3.5 |
| Compatibility | 5% | 3.0 | 3.0 |
| Observability | 4% | 1.5 | 1.2 |
| Backup and recovery | 3% | 1.0 | 0.6 |
| SEO | 2% | 2.5 | 1.0 |
| Localization | 2% | 3.5 | 1.4 |
| **Final weighted total** | **100%** |  | **61.2 / 100** |

The local score improved by 2.0 points, but the platform remains below the
requested 80/100 and is **not release-ready on the available evidence**.
Production load, accessibility, compatibility, uptime, observability, and
backup/restore targets remain unverified; no independent security/dependency
scan or coverage measurement was run.
