import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMediaMetadataMigration } from '../src/services/sqlMigrationService.js';

function migrationClient({ version = 150000, readOnly = 'off', isSuperuser = false, failOnSql = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM pg_roles')) {
        return {
          rows: [{
            database_name: 'existing_db',
            database_user: 'migration_user',
            server_version_num: version,
            transaction_read_only: readOnly,
            is_superuser: isSuperuser,
          }],
        };
      }
      if (sql.includes('FROM information_schema.columns')) return { rows: [{ data_type: 'bigint' }] };
      if (sql.includes('has_schema_privilege')) {
        return { rows: [{ can_create: true, can_reference: true }] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ history_exists: false, metadata_exists: false }] };
      }
      if (sql.includes('CREATE TABLE public.backend_media_file_metadata') && failOnSql) {
        throw new Error('simulated migration failure');
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const migration = {
  migrationName: '001_media_file_metadata',
  sql: 'CREATE TABLE public.backend_media_file_metadata (id bigint PRIMARY KEY)',
  checksum: 'checked-test-checksum',
};

test('migration dry run verifies the target without executing DDL', async () => {
  const client = migrationClient();
  const result = await runMediaMetadataMigration(client, migration);

  assert.equal(result.status, 'pending');
  assert.equal(client.calls.some(({ sql }) => sql === migration.sql), false);
  assert.equal(client.calls.some(({ sql }) => sql === 'BEGIN'), false);
});

test('migration apply is transactional and records the checksum', async () => {
  const client = migrationClient();
  const result = await runMediaMetadataMigration(client, {
    ...migration,
    applicationRole: 'app_user',
    apply: true,
  });

  assert.equal(result.status, 'applied');
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.ok(client.calls.some(({ sql }) => sql === migration.sql));
  assert.ok(client.calls.some(({ sql }) =>
    sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE')
    && sql.includes('TO "app_user"')));
  assert.ok(client.calls.some(({ sql, values }) =>
    sql.includes('INSERT INTO public.backend_schema_migrations')
    && values[0] === migration.migrationName
    && values[1] === migration.checksum));
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('migration refuses PostgreSQL 13 before issuing DDL', async () => {
  const client = migrationClient({ version: 130012 });

  await assert.rejects(
    runMediaMetadataMigration(client, { ...migration, apply: true }),
    /PostgreSQL 15 or newer/,
  );
  assert.equal(client.calls.some(({ sql }) => sql === migration.sql), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('migration rolls back on a DDL failure', async () => {
  const client = migrationClient({ failOnSql: true });

  await assert.rejects(
    runMediaMetadataMigration(client, { ...migration, apply: true }),
    /simulated migration failure/,
  );
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});
