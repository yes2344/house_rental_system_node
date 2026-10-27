import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { getMediaStorageReport } from '../src/services/mediaStorageService.js';
import { requireAdministrator } from '../src/middleware/requireAdministrator.js';

const temporaryDirectories = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test('storage report counts files and bytes and identifies missing and orphaned references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'infinity-media-report-'));
  temporaryDirectories.push(root);
  const publicRoot = path.join(root, 'public');
  const privateRoot = path.join(root, 'private');
  const publicDirectory = path.join(publicRoot, 'property_images');
  const privateDirectory = path.join(privateRoot, 'private_property_images');
  await Promise.all([
    mkdir(publicDirectory, { recursive: true }),
    mkdir(privateDirectory, { recursive: true }),
  ]);
  await writeFile(path.join(publicDirectory, 'present.jpg'), Buffer.alloc(17));
  await writeFile(path.join(publicDirectory, 'orphan.png'), Buffer.alloc(5));
  await writeFile(path.join(privateDirectory, 'present.jpg'), Buffer.alloc(9));
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM user_propertyimage/);
      return {
        rowCount: 2,
        rows: [
          { image: 'property_images/present.jpg', original_image: 'private_property_images/present.jpg' },
          { image: 'property_images/missing.webp', original_image: '../escape' },
        ],
      };
    },
  };

  const report = await getMediaStorageReport(pool, {
    publicRoot,
    privateRoot,
    capacityBytes: 100,
    warningPercent: 20,
  });

  assert.equal(report.storage.file_count, 3);
  assert.equal(report.storage.used_bytes, 31);
  assert.equal(report.storage.configured_remaining_bytes, 69);
  assert.equal(report.storage.configured_usage_percent, 31);
  assert.equal(report.storage.warning, true);
  assert.equal(report.database_reconciliation.image_records, 2);
  assert.equal(report.database_reconciliation.missing_files, 1);
  assert.equal(report.database_reconciliation.invalid_references, 1);
  assert.equal(report.database_reconciliation.orphaned_public_files, 1);
  assert.equal(report.database_reconciliation.orphaned_private_files, 0);
});

test('storage report does not claim an allocated quota when none was configured', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'infinity-media-report-'));
  temporaryDirectories.push(root);
  const pool = { async query() { return { rowCount: 0, rows: [] }; } };
  const report = await getMediaStorageReport(pool, {
    publicRoot: path.join(root, 'public'),
    privateRoot: path.join(root, 'private'),
    capacityBytes: null,
    warningPercent: 80,
  });
  assert.equal(report.storage.configured_capacity_bytes, null);
  assert.equal(report.storage.configured_usage_percent, null);
  assert.equal(report.storage.warning, false);
  assert.equal(report.storage.public.filesystem_total_bytes > 0, true);
});

test('storage report authorization is restricted to active administrators', async () => {
  const middleware = requireAdministrator({
    pool: {
      async query(_sql, values) {
        assert.deepEqual(values, [42]);
        return { rows: [{ is_staff: true, is_superuser: false, role: 'agent' }] };
      },
    },
  });
  let passedError;
  let passedNext = false;
  await middleware({ userId: 42 }, {}, (error) => {
    passedError = error;
    passedNext = true;
  });
  assert.equal(passedNext, true);
  assert.equal(passedError.statusCode, 403);

  const adminMiddleware = requireAdministrator({
    pool: {
      async query() {
        return { rows: [{ is_staff: true, is_superuser: false, role: 'administrator' }] };
      },
    },
  });
  let adminError;
  await adminMiddleware({ userId: 7 }, {}, (error) => {
    adminError = error;
  });
  assert.equal(adminError, undefined);
});
