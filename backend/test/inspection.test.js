import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectDatabase } from '../src/services/databaseInspectionService.js';

test('schema inspection parameterizes catalog filters inside a read-only transaction', async () => {
  const calls = [];
  const rowsByQuery = [
    { rows: [{ transaction_read_only: 'on' }] },
    { rows: [{ schema_name: 'public' }], rowCount: 1 },
    { rows: [{ table_name: 'properties', column_name: 'id' }] },
    { rows: [{ table_name: 'properties', constraint_type: 'PRIMARY KEY' }] },
    { rows: [{ table_name: 'properties', index_name: 'properties_pkey' }] },
    { rows: [{ sequence_name: 'properties_id_seq' }] },
    { rows: [{ table_name: 'properties', privilege_type: 'SELECT' }] },
    { rows: [] },
  ];
  const client = {
    query: async (text, values) => {
      calls.push({ text, values });
      if (['BEGIN READ ONLY', 'COMMIT', 'ROLLBACK'].includes(text)) {
        return { rows: [], rowCount: 0 };
      }
      return rowsByQuery.shift();
    },
    release: () => calls.push({ text: 'release' }),
  };
  const pool = { connect: async () => client };

  const result = await inspectDatabase(pool, 'public');

  assert.equal(result.schemaExists, true);
  assert.equal(result.server.transaction_read_only, 'on');
  assert.equal(result.columns[0].column_name, 'id');
  assert.equal(result.constraints[0].constraint_type, 'PRIMARY KEY');
  assert.equal(result.indexes[0].index_name, 'properties_pkey');
  assert.equal(result.sequences[0].sequence_name, 'properties_id_seq');
  assert.match(calls[6].text, /pg_sequence/);
  assert.equal(result.currentRoleGrants[0].privilege_type, 'SELECT');
  assert.deepEqual(calls.map(({ text }) => text).slice(0, 1), ['BEGIN READ ONLY']);
  assert.equal(calls.at(-2).text, 'COMMIT');
  assert.equal(calls.at(-1).text, 'release');
  for (const call of calls.slice(2, 8)) {
    assert.match(call.text, /\$1/);
    assert.deepEqual(call.values, ['public']);
  }
});
