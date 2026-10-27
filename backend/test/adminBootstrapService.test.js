import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPassword } from '../src/services/passwordService.js';
import { promoteExistingSiteadmin } from '../src/services/adminBootstrapService.js';

function bootstrapClient({ accounts = [{ id: 23, is_active: true }], conflictingEmail = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM auth_user') && sql.includes('lower(username)')) {
        return { rows: accounts, rowCount: accounts.length };
      }
      if (sql.includes('FROM auth_user') && sql.includes('lower(email)')) {
        return { rows: conflictingEmail ? [{ id: 99 }] : [], rowCount: conflictingEmail ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const config = {
  email: 'siteadmin@example.test',
  password: 'fresh-deployment-secret-123',
};

test('siteadmin bootstrap dry run checks the target without modifying accounts', async () => {
  const client = bootstrapClient();

  const result = await promoteExistingSiteadmin(client, config);

  assert.deepEqual(result, { status: 'ready', username: 'siteadmin' });
  assert.equal(client.calls.some(({ sql }) => /^(UPDATE|INSERT)/i.test(sql.trim())), false);
  assert.equal(client.calls.some(({ sql }) => sql.includes('pg_advisory_xact_lock')), false);
});

test('siteadmin bootstrap promotes only the existing account and resets its password', async () => {
  const client = bootstrapClient();

  const result = await promoteExistingSiteadmin(client, { ...config, apply: true });
  const accountUpdate = client.calls.find(({ sql }) => sql.includes('UPDATE auth_user'));
  const profileUpsert = client.calls.find(({ sql }) => sql.includes('INSERT INTO accounts_profile'));
  const sessionRevocation = client.calls.find(({ sql }) => sql.includes('UPDATE accounts_tabsessiontoken'));

  assert.deepEqual(result, { status: 'promoted', username: 'siteadmin' });
  assert.equal(
    client.calls.filter(({ sql }) => sql.includes('pg_advisory_xact_lock')).length,
    2,
  );
  assert.ok(accountUpdate);
  assert.equal(accountUpdate.values[0], config.email);
  assert.equal(await verifyPassword(config.password, accountUpdate.values[1]), true);
  assert.equal(accountUpdate.values[2], 23);
  assert.ok(profileUpsert?.sql.includes("role = 'administrator'"));
  assert.ok(sessionRevocation);
  assert.equal(client.calls.some(({ sql }) => sql.includes('brokeragesettings')), false);
});

test('siteadmin bootstrap rejects missing, duplicate, inactive, and conflicting targets', async (t) => {
  await t.test('missing account', async () => {
    await assert.rejects(
      promoteExistingSiteadmin(bootstrapClient({ accounts: [] }), config),
      /account was not found/,
    );
  });
  await t.test('duplicate account', async () => {
    await assert.rejects(
      promoteExistingSiteadmin(bootstrapClient({
        accounts: [{ id: 1, is_active: true }, { id: 2, is_active: true }],
      }), config),
      /More than one account/,
    );
  });
  await t.test('inactive account', async () => {
    await assert.rejects(
      promoteExistingSiteadmin(bootstrapClient({ accounts: [{ id: 23, is_active: false }] }), config),
      /account is inactive/,
    );
  });
  await t.test('email already in use', async () => {
    const client = bootstrapClient({ conflictingEmail: true });
    await assert.rejects(
      promoteExistingSiteadmin(client, { ...config, apply: true }),
      /already assigned/,
    );
    assert.equal(client.calls.some(({ sql }) => sql.includes('UPDATE auth_user')), false);
  });
});
