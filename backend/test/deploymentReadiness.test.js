import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkDeploymentReadiness } from '../src/services/deploymentReadinessService.js';

const requiredTables = [
  'auth_user',
  'accounts_profile',
  'accounts_tabsessiontoken',
  'accounts_userpreferences',
  'user_property',
  'user_propertyimage',
  'properties_amenity',
  'properties_location',
  'backend_media_file_metadata',
];

async function makeMediaRoots(root) {
  const publicRoot = path.join(root, 'persistent', 'public');
  const privateRoot = path.join(root, 'persistent', 'private');
  await Promise.all([
    mkdir(publicRoot, { recursive: true }),
    mkdir(privateRoot, { recursive: true }),
  ]);
  return { publicRoot, privateRoot };
}

function makePool({
  version = 130012,
  readOnly = 'off',
  isSuperuser = false,
  tables = requiredTables,
  missingPrivileges = [],
} = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM pg_roles')) {
        return {
          rows: [{
            database_name: 'app_db',
            database_user: 'app_user',
            server_version_num: version,
            transaction_read_only: readOnly,
            search_path_schemas: ['public'],
            is_superuser: isSuperuser,
          }],
        };
      }
      if (sql.includes('FROM unnest')) return { rows: missingPrivileges };
      return { rows: tables.map((table_name) => ({ table_name })) };
    },
  };
}

test('deployment preflight checks database and media and flags unsupported PostgreSQL 13', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deployment-readiness-'));
  try {
    const mediaConfig = await makeMediaRoots(root);
    const report = await checkDeploymentReadiness({
      pool: makePool(),
      mediaConfig: { ...mediaConfig, capacityBytes: 1000 },
      applicationRoot: path.join(root, 'application'),
      environment: { NODE_ENV: 'production', PGSCHEMA: 'public' },
    });

    assert.equal(report.ready, false);
    assert.ok(report.blockers.some((blocker) => blocker.includes('PostgreSQL 13 is end-of-life')));
    assert.deepEqual(report.database.missing_required_tables, []);
    assert.equal(report.media.public.writable, true);
    assert.equal(report.media.private.writable, true);
    assert.ok(report.warnings.some((warning) => warning.includes('cannot prove persistence')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deployment preflight reports missing schema tables and unsafe database role', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deployment-readiness-'));
  try {
    const mediaConfig = await makeMediaRoots(root);
    const report = await checkDeploymentReadiness({
      pool: makePool({ version: 150000, readOnly: 'on', isSuperuser: true, tables: ['auth_user'] }),
      mediaConfig: { ...mediaConfig, capacityBytes: null },
      applicationRoot: path.join(root, 'application'),
      environment: { NODE_ENV: 'production' },
    });

    assert.equal(report.ready, false);
    assert.equal(report.database.missing_required_tables.length, requiredTables.length - 1);
    assert.ok(report.blockers.some((blocker) => blocker.includes('read-only')));
    assert.ok(report.blockers.some((blocker) => blocker.includes('superuser')));
    assert.ok(report.warnings.some((warning) => warning.includes('MEDIA_CAPACITY_BYTES')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deployment preflight requires application write grants and media outside the release', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deployment-readiness-'));
  try {
    const applicationRoot = path.join(root, 'application');
    const mediaConfig = {
      publicRoot: path.join(applicationRoot, 'media', 'public'),
      privateRoot: path.join(applicationRoot, 'media', 'private'),
      capacityBytes: 1000,
    };
    await Promise.all([
      mkdir(mediaConfig.publicRoot, { recursive: true }),
      mkdir(mediaConfig.privateRoot, { recursive: true }),
    ]);
    const report = await checkDeploymentReadiness({
      pool: makePool({
        version: 150000,
        missingPrivileges: [{ table_name: 'user_property', privilege: 'DELETE' }],
      }),
      mediaConfig,
      applicationRoot,
      environment: { NODE_ENV: 'production' },
    });

    assert.equal(report.ready, false);
    assert.deepEqual(report.database.missing_table_privileges, ['user_property:DELETE']);
    assert.equal(report.media.public.outside_application, false);
    assert.ok(report.blockers.some((blocker) => blocker.includes('outside the application release')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
