import { createPool } from '../src/db.js';
import { getDatabaseConfig } from '../src/config/env.js';
import { seedMissingPublicInformationPages } from '../src/services/publicInformationPageSeedService.js';

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes('--apply');
const unknownArguments = argumentsList.filter((argument) => argument !== '--apply');
if (unknownArguments.length > 0) {
  throw new Error(`Unsupported arguments: ${unknownArguments.join(', ')}`);
}

const pool = createPool(getDatabaseConfig());
let client;
try {
  client = await pool.connect();
  const target = await client.query('SELECT current_database() AS database');
  const result = await seedMissingPublicInformationPages(client, { apply });
  console.info(JSON.stringify({
    database: target.rows[0]?.database,
    ...result,
    mode: apply ? 'apply' : 'dry-run',
  }, null, 2));
  if (!apply && result.missing.length) {
    console.info('No changes were made. After backup and review, create only missing pages with: npm run seed:public-pages -- --apply');
  }
} catch (error) {
  console.error('Public information page initialization failed:', error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
