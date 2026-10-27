import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountPatchSchema, loginSchema, preferencesSchema, registrationSchema } from '../src/validators/accounts.js';
import { paginationQuerySchema } from '../src/validators/pagination.js';

test('pagination validation provides bounded defaults', () => {
  assert.deepEqual(paginationQuerySchema.parse({}), { page: 1, page_size: 20 });
  assert.deepEqual(
    paginationQuerySchema.parse({ page: '3', page_size: '50' }),
    { page: 3, page_size: 50 },
  );
});

test('pagination validation rejects invalid and excessive values', () => {
  assert.equal(paginationQuerySchema.safeParse({ page: '0' }).success, false);
  assert.equal(paginationQuerySchema.safeParse({ page_size: '101' }).success, false);
});

test('account validators reject role escalation and unsupported fields', () => {
  assert.equal(accountPatchSchema.safeParse({ role: 'administrator' }).success, false);
  assert.equal(preferencesSchema.safeParse({ locale: 'fr' }).success, false);
  assert.equal(preferencesSchema.safeParse({ unsupported: true }).success, false);
});

test('registration and login validators require usable credentials', () => {
  assert.equal(loginSchema.safeParse({ password: 'pass' }).success, false);
  assert.equal(
    registrationSchema.safeParse({
      username: 'alice',
      email: 'alice@example.test',
      password: 'alice-secret-42',
    }).success,
    false,
  );
  assert.equal(
    registrationSchema.safeParse({
      username: 'alice',
      email: 'alice@example.test',
      password: 'Evergreen!Place42',
    }).success,
    true,
  );
});
