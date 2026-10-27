# SQL migration policy

The current deployable backend is Node.js and PostgreSQL; the former Django
application has been removed. The PostgreSQL schema snapshot and model
inventory were captured before that source removal. They are useful references
for existing databases, not a complete schema-creation migration for a new
database. No SQL migration has been applied to a live or production database.

The deployment target is an existing database. Node expects the established
application tables and does not initialize an empty database; a new empty
database is not a supported deployment target. The repository's PostgreSQL 18
catalog snapshot is from a separate local candidate, not the confirmed
HahuCloud database. The intended HahuCloud database was reported as PostgreSQL
13.12, which is end-of-life upstream; production must use a provider-supported
PostgreSQL 15+ major version. Compare and verify the actual target catalog
before connecting the application. Run `npm run check:deployment` from
`backend/` to perform a read-only schema/runtime/media preflight.

The only checked-in migration adds media-file metadata to the existing
`user_propertyimage` table. It is not applied automatically and must first be
tested against a verified restore of the target database. Do not run it
directly on production as part of application startup. `npm run migrate` is a
no-DDL preflight; after review, backup, and isolated-restore verification, the
explicit `npm run migrate -- --apply` command records a SHA-256 checksum and
applies it transactionally. Use a dedicated non-superuser migration role with
`CREATE` on `public` and `REFERENCES` on `public.user_propertyimage`,
optionally supplied through `MIGRATION_DATABASE_URL`. Set
`APPLICATION_DATABASE_ROLE` to have the migration grant CRUD privileges on the
new metadata table to the non-superuser application role. The web process
never runs migrations automatically. Future SQL migrations must:

- be versioned, reviewed SQL files with a recorded checksum;
- be additive and backward-compatible with existing data;
- preserve current primary keys, foreign keys, sequence values, and records;
- include preconditions and post-migration checks for affected constraints;
- use transactions where PostgreSQL permits the operation;
- never drop, rename, truncate, or recreate existing tables without a
  separately approved plan and verified restorable backup;
- run first against a restored, isolated copy of the target PostgreSQL
  version.

Creating the migration-history table or applying any DDL to an existing
database requires an approved schema plan. The explicit migration command is
never run automatically by the web process. The checked-in
`001_media_file_metadata.sql` migration is additive and has not been applied
to a live or production database. Catalog inspection uses a separate
read-only pool.
