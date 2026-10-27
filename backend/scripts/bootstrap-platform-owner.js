import { createPool } from '../src/db.js';
import { getDatabaseConfig } from '../src/config/env.js';
import { bootstrapPlatformOwner } from '../src/services/adminBootstrapService.js';

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes('--apply');
const unknownArguments = argumentsList.filter((argument) => argument !== '--apply');
if (unknownArguments.length > 0) {
  throw new Error(`Unsupported bootstrap arguments: ${unknownArguments.join(', ')}`);
}

const username = process.env.PLATFORM_OWNER_USERNAME?.trim();
const email = process.env.PLATFORM_OWNER_EMAIL?.trim();
const password = process.env.PLATFORM_OWNER_PASSWORD;
if (!username || !email || typeof password !== 'string') {
  throw new Error(
    'Set PLATFORM_OWNER_USERNAME, PLATFORM_OWNER_EMAIL, and PLATFORM_OWNER_PASSWORD in the private application environment.',
  );
}
if (apply && process.env.PLATFORM_OWNER_BOOTSTRAP_CONFIRM !== 'create-platform-owner') {
  throw new Error('Set PLATFORM_OWNER_BOOTSTRAP_CONFIRM=create-platform-owner to confirm account creation.');
}

const pool = createPool(getDatabaseConfig());
let client;
let transactionStarted = false;

try {
  client = await pool.connect();
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  transactionStarted = true;
  const result = await bootstrapPlatformOwner(client, {
    username,
    email,
    password,
    apply,
  });
  await client.query('COMMIT');
  transactionStarted = false;
  console.info(JSON.stringify({
    status: result.status,
    username: result.username,
    mode: apply ? 'apply' : 'dry-run',
  }, null, 2));
} catch (error) {
  if (transactionStarted) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Platform Owner bootstrap rollback failed:', rollbackError.code || rollbackError.name);
    }
  }
  if (error.code) {
    console.error('Platform Owner bootstrap failed due to a database error:', error.code);
  } else {
    console.error('Platform Owner bootstrap failed:', error.message);
  }
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
