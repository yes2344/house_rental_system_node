import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db.js';
import { getDatabaseConfig } from '../src/config/env.js';
import {
  runMediaMetadataMigration,
  runPropertyCurrencyMigration,
  runPropertyPriceNegotiableMigration,
} from '../src/services/sqlMigrationService.js';

const migrations = [
  {
    name: '001_media_file_metadata',
    path: '../db/migrations/001_media_file_metadata.sql',
    run: runMediaMetadataMigration,
  },
  {
    name: '002_property_currency',
    path: '../db/migrations/002_property_currency.sql',
    run: runPropertyCurrencyMigration,
  },
  {
    name: '003_negotiable_property_price',
    path: '../db/migrations/003_negotiable_property_price.sql',
    run: runPropertyPriceNegotiableMigration,
  },
];
const apply = process.argv.includes('--apply');
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--apply');
if (unknownArguments.length > 0) {
  throw new Error(`Unsupported migration arguments: ${unknownArguments.join(', ')}`);
}

const pool = createPool(getDatabaseConfig({ migration: true }));
let client;
try {
  client = await pool.connect();
  for (const migration of migrations) {
    const sql = await readFile(
      fileURLToPath(new URL(migration.path, import.meta.url)),
      'utf8',
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const result = await migration.run(client, {
      migrationName: migration.name,
      sql,
      checksum,
      ...(migration.name === '001_media_file_metadata'
        ? { applicationRole: process.env.APPLICATION_DATABASE_ROLE?.trim() || undefined }
        : {}),
      apply,
    });
    console.info(JSON.stringify({
      migration: migration.name,
      ...result,
      checksum,
      mode: apply ? 'apply' : 'dry-run',
    }, null, 2));
    if (!apply && result.status === 'pending') {
      console.info('No changes were made. Apply only after backup and isolated-restore verification with: npm run migrate -- --apply');
    }
  }
} catch (error) {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
