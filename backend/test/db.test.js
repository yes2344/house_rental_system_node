import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPool, withReadOnlyTransaction, withTransaction } from '../src/db.js';

test('PostgreSQL application pool allows writes while retaining a statement timeout', async () => {
  const pool = createPool({
    host: '127.0.0.1',
    port: 5432,
    database: 'test_database',
    user: 'test_user',
    password: 'test_password',
  });
  assert.doesNotMatch(pool.options.options, /default_transaction_read_only=on/);
  assert.match(pool.options.options, /statement_timeout=5000/);
  await pool.end();
});

test('PostgreSQL inspection pool starts in read-only mode', async () => {
  const pool = createPool({
    host: '127.0.0.1',
    port: 5432,
    database: 'test_database',
    user: 'test_user',
    password: 'test_password',
  }, { readOnly: true });
  assert.match(pool.options.options, /default_transaction_read_only=on/);
  await pool.end();
});

test('read-only transactions begin read-only and commit successful parameterized queries', async () => {
  const calls = [];
  const client = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [{ id: 7 }] };
    },
    release: () => calls.push({ text: 'release' }),
  };
  const pool = { connect: async () => client };

  const result = await withReadOnlyTransaction(pool, (connection) => (
    connection.query('SELECT id FROM properties WHERE id = $1', [7])
  ));

  assert.deepEqual(result.rows, [{ id: 7 }]);
  assert.deepEqual(calls.map(({ text }) => text), [
    'BEGIN READ ONLY',
    'SELECT id FROM properties WHERE id = $1',
    'COMMIT',
    'release',
  ]);
  assert.deepEqual(calls[1].values, [7]);
});

test('read-only transactions roll back failed operations and release the client', async () => {
  const calls = [];
  const failure = new Error('query failed');
  const client = {
    query: async (text) => {
      calls.push(text);
      if (text === 'SELECT broken') throw failure;
    },
    release: () => calls.push('release'),
  };
  const pool = { connect: async () => client };

  await assert.rejects(
    withReadOnlyTransaction(pool, (connection) => connection.query('SELECT broken')),
    failure,
  );
  assert.deepEqual(calls, ['BEGIN READ ONLY', 'SELECT broken', 'ROLLBACK', 'release']);
});

test('read-only transactions preserve the original error when rollback also fails', async () => {
  const failure = new Error('query failed');
  const rollbackFailure = new Error('rollback failed');
  const client = {
    query: async (text) => {
      if (text === 'SELECT broken') throw failure;
      if (text === 'ROLLBACK') throw rollbackFailure;
    },
    release: () => {},
  };
  const pool = { connect: async () => client };

  await assert.rejects(
    withReadOnlyTransaction(pool, (connection) => connection.query('SELECT broken')),
    (error) => error === failure && error.rollbackError === rollbackFailure,
  );
});

test('write transactions commit successful work', async () => {
  const calls = [];
  const client = {
    query: async (text) => calls.push(text),
    release: () => calls.push('release'),
  };
  const result = await withTransaction({ connect: async () => client }, async (connection) => {
    await connection.query('INSERT INTO example (value) VALUES ($1)', ['value']);
    return 'created';
  });

  assert.equal(result, 'created');
  assert.deepEqual(calls, [
    'BEGIN',
    'INSERT INTO example (value) VALUES ($1)',
    'COMMIT',
    'release',
  ]);
});

test('write transactions roll back failures and preserve the original error', async () => {
  const failure = new Error('insert failed');
  const rollbackFailure = new Error('rollback failed');
  const calls = [];
  const client = {
    query: async (text) => {
      calls.push(text);
      if (text.startsWith('INSERT')) throw failure;
      if (text === 'ROLLBACK') throw rollbackFailure;
    },
    release: () => calls.push('release'),
  };

  await assert.rejects(
    withTransaction({ connect: async () => client }, (connection) => (
      connection.query('INSERT INTO example DEFAULT VALUES')
    )),
    (error) => error === failure && error.rollbackError === rollbackFailure,
  );
  assert.deepEqual(calls, ['BEGIN', 'INSERT INTO example DEFAULT VALUES', 'ROLLBACK', 'release']);
});
