import pg from 'pg';
import { getDatabaseConfig } from './config/env.js';

export function createPool(config = getDatabaseConfig(), { readOnly = false } = {}) {
  const options = ['-c statement_timeout=5000'];
  if (readOnly) options.push('-c default_transaction_read_only=on');

  return new pg.Pool({
    ...config,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 5,
    options: options.join(' '),
  });
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await callback(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withReadOnlyTransaction(pool, callback) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    const result = await callback(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
