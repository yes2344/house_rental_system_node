import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

const password = 'Existing!Password9283';
const digest = pbkdf2Sync(password, 'test-salt', 1200, 32, 'sha256').toString('base64');
const encodedPassword = `pbkdf2_sha256$1200$test-salt$${digest}`;

function fakePool(overrides = {}) {
  const calls = [];
  const account = {
    id: 7,
    username: 'alice',
    email: 'alice@example.test',
    first_name: 'Alice',
    last_name: 'Example',
    is_active: true,
    is_staff: false,
    is_superuser: false,
    role: 'customer',
    phone: '',
    management_permissions: [],
    agent_approved: false,
    agent_onboarding_required: false,
    agent_password_changed: true,
    assigned_city_id: null,
    assigned_city_name: null,
    assigned_city_name_am: null,
    platform_owner_id: null,
  };
  Object.assign(account, overrides);
  const query = async (text, values = []) => {
    calls.push({ text, values });
    const sql = text.trim().replace(/\s+/g, ' ');
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('WHERE lower(profile.phone)')) return { rows: [], rowCount: 0 };
    if (sql.includes('WHERE lower(username) = lower($1)')) {
      return { rows: [{ id: account.id, password: encodedPassword }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT is_active FROM auth_user')) {
      return { rows: [{ is_active: true }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT account.id, account.username')) {
      return { rows: [{ ...account }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO accounts_tabsessiontoken')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT session.id AS session_id')) {
      return { rows: [{ session_id: 14, user_id: account.id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };

  return {
    calls,
    connect: async () => ({ query, release() {} }),
    query,
  };
}

async function startServer(pool) {
  const server = createApp({ pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function registrationPool() {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    const sql = text.trim().replace(/\s+/g, ' ');
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT username, email FROM auth_user')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('INSERT INTO auth_user')) return { rows: [{ id: 18 }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO accounts_profile')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT account.id, account.username')) {
      return {
        rows: [{
          id: 18,
          username: 'newuser',
          email: 'newuser@example.test',
          first_name: '',
          last_name: '',
          is_active: true,
          is_staff: false,
          is_superuser: false,
          role: 'customer',
          phone: '555-0101',
          management_permissions: [],
          agent_approved: false,
          agent_onboarding_required: false,
          agent_password_changed: true,
          assigned_city_id: null,
          assigned_city_name: null,
          assigned_city_name_am: null,
          platform_owner_id: null,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    calls,
    connect: async () => ({ query, release() {} }),
  };
}

test('CSRF, login, current account, and logout preserve the Django client contract', async () => {
  const pool = fakePool();
  const { server, baseUrl } = await startServer(pool);
  try {
    const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf/`);
    assert.equal(csrfResponse.status, 200);
    const { csrf_token: csrfToken } = await csrfResponse.json();
    const csrfCookie = csrfResponse.headers.get('set-cookie').split(';')[0];

    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: csrfCookie,
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({ identifier: 'alice', password }),
    });
    assert.equal(loginResponse.status, 200);
    const session = await loginResponse.json();
    assert.equal(session.username, 'alice');
    assert.equal(session.role, 'customer');
    assert.equal(session.csrf_token.length, 64);
    assert.equal(session.session_token.length > 30, true);
    assert.equal('password' in session, false);

    const current = await fetch(`${baseUrl}/api/v1/auth/me/`, {
      headers: { Authorization: `Bearer ${session.session_token}` },
    });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).id, 7);

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.session_token}` },
    });
    assert.equal(logout.status, 204);
    assert.ok(pool.calls.some(({ text }) => text.includes('INSERT INTO accounts_tabsessiontoken')));
    assert.ok(pool.calls.some(({ text }) => text.includes('SET revoked_at = CURRENT_TIMESTAMP')));
  } finally {
    await closeServer(server);
  }
});

test('login rejects missing CSRF credentials before querying credentials', async () => {
  const pool = fakePool();
  const { server, baseUrl } = await startServer(pool);
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'alice', password }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.message, 'CSRF verification failed. Request not allowed.');
    assert.equal(pool.calls.length, 0);
  } finally {
    await closeServer(server);
  }
});

test('login rejects a CSRF token sent from an untrusted origin', async () => {
  const pool = fakePool();
  const { server, baseUrl } = await startServer(pool);
  try {
    const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf/`);
    const { csrf_token: csrfToken } = await csrfResponse.json();
    const cookie = csrfResponse.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${baseUrl}/api/v1/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.invalid',
        Cookie: cookie,
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({ identifier: 'alice', password }),
    });
    assert.equal(response.status, 403);
    assert.equal(pool.calls.length, 0);
  } finally {
    await closeServer(server);
  }
});

test('protected account routes reject requests without a bearer session', async () => {
  const { server, baseUrl } = await startServer(fakePool());
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/me/`);
    assert.equal(response.status, 401);
  } finally {
    await closeServer(server);
  }
});

test('account serialization does not grant unapproved agents management permissions', async () => {
  const pool = fakePool({
    role: 'agent',
    agent_approved: false,
    management_permissions: ['announcements.review_assigned'],
  });
  const { server, baseUrl } = await startServer(pool);
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/me/`, {
      headers: { Authorization: 'Bearer valid-session-token' },
    });
    const account = await response.json();
    assert.equal(account.role, 'agent');
    assert.deepEqual(account.management_permissions, []);
  } finally {
    await closeServer(server);
  }
});

test('approved agent permissions are restricted to the Django-defined work set', async () => {
  const pool = fakePool({
    role: 'agent',
    agent_approved: true,
    management_permissions: ['announcements.review_assigned', 'users.manage'],
  });
  const { server, baseUrl } = await startServer(pool);
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/me/`, {
      headers: { Authorization: 'Bearer valid-session-token' },
    });
    const account = await response.json();
    assert.deepEqual(account.management_permissions, [
      'properties.manage_assigned',
      'viewings.manage_assigned',
      'locations.manage_subcities',
      'announcements.review_assigned',
    ]);
    assert.equal(account.management_permissions.includes('users.manage'), false);
  } finally {
    await closeServer(server);
  }
});

test('registration creates a customer transactionally with a Django-compatible password hash', async () => {
  const pool = registrationPool();
  const { server, baseUrl } = await startServer(pool);
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'newuser',
        email: 'newuser@example.test',
        password: 'Evergreen!Place42',
        phone: '555-0101',
      }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.role, 'customer');
    assert.equal(result.phone, '555-0101');
    assert.ok(pool.calls.some(({ text, values }) => (
      text.includes('INSERT INTO auth_user') && values[0].startsWith('pbkdf2_sha256$')
    )));
    assert.ok(pool.calls.some(({ text }) => text === 'COMMIT'));
  } finally {
    await closeServer(server);
  }
});

test('browser origins outside the allow list are rejected', async () => {
  const { server, baseUrl } = await startServer(fakePool());
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/csrf/`, {
      headers: { Origin: 'https://attacker.invalid' },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.message, 'Origin is not allowed.');
  } finally {
    await closeServer(server);
  }
});
