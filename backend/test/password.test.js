import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/services/passwordService.js';

test('Django PBKDF2-SHA256 password hashes remain verifiable', async () => {
  const password = 'Existing!Password9283';
  const salt = 'django-compatible-salt';
  const digest = pbkdf2Sync(password, salt, 1200, 32, 'sha256').toString('base64');
  const encoded = `pbkdf2_sha256$1200$${salt}$${digest}`;

  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('incorrect password', encoded), false);
});

test('new passwords use Django-compatible PBKDF2-SHA256 encoding', async () => {
  const encoded = await hashPassword('New!Password9283');
  const [algorithm, rounds, salt, digest] = encoded.split('$');

  assert.equal(algorithm, 'pbkdf2_sha256');
  assert.equal(Number(rounds), 1_000_000);
  assert.ok(salt);
  assert.equal(Buffer.from(digest, 'base64').length, 32);
  assert.equal(await verifyPassword('New!Password9283', encoded), true);
});

test('malformed or unsupported Django password hashes do not authenticate', async () => {
  assert.equal(await verifyPassword('password', 'bcrypt$2a$10$invalid'), false);
  assert.equal(await verifyPassword('password', 'pbkdf2_sha256$0$salt$invalid'), false);
});
