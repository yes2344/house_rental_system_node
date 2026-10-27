import { createPool } from '../src/db.js';
import { getDatabaseConfig } from '../src/config/env.js';
import { promoteExistingSiteadmin } from '../src/services/adminBootstrapService.js';

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes('--apply');
const unknownArguments = argumentsList.filter((argument) => argument !== '--apply');
if (unknownArguments.length > 0) {
  throw new Error(`Unsupported bootstrap arguments: ${unknownArguments.join(', ')}`);
}

const email = process.env.SITEADMIN_BOOTSTRAP_EMAIL?.trim();
const password = process.env.SITEADMIN_BOOTSTRAP_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('SITEADMIN_BOOTSTRAP_EMAIL must be a valid email address.');
}
if (typeof password !== 'string' || password.length < 16) {
  throw new Error('SITEADMIN_BOOTSTRAP_PASSWORD must contain at least 16 characters.');
}
if (apply && process.env.SITEADMIN_BOOTSTRAP_CONFIRM !== 'promote-existing-siteadmin') {
  throw new Error('Set SITEADMIN_BOOTSTRAP_CONFIRM=promote-existing-siteadmin to confirm promotion.');
}

const pool = createPool(getDatabaseConfig());
let client;
let transactionStarted = false;

try {
  client = await pool.connect();
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  transactionStarted = true;
  const result = await promoteExistingSiteadmin(client, { email, password, apply });
  await client.query('COMMIT');
  transactionStarted = false;
  console.info(JSON.stringify({
    ...result,
    mode: apply ? 'apply' : 'dry-run',
    platformOwnerChanged: false,
  }, null, 2));
} catch (error) {
  if (transactionStarted) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Siteadmin bootstrap rollback failed:', rollbackError.code || rollbackError.name);
    }
  }
  console.error('Siteadmin bootstrap failed:', error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
