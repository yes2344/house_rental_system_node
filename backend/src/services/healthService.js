import { withReadOnlyTransaction } from '../db.js';

export async function checkDatabase(pool) {
  await withReadOnlyTransaction(pool, (client) => client.query('SELECT 1'));
}
