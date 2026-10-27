import { databaseSchema } from '../src/config/env.js';
import { createPool } from '../src/db.js';
import { inspectDatabase } from '../src/services/databaseInspectionService.js';

let pool;

try {
  pool = createPool(undefined, { readOnly: true });
  const result = await inspectDatabase(pool, databaseSchema);
  if (!result.schemaExists) {
    throw new Error(`Configured schema "${databaseSchema}" does not exist.`);
  }
  if (result.server.transaction_read_only !== 'on') {
    throw new Error('Database inspection transaction was not read-only.');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Database inspection failed:', error.code || error.message || error.name);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
