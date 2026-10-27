import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import { test } from 'node:test';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { accountExtensionsRouter } from '../src/routes/accountExtensions.js';

const userId = 7;
const uid = Buffer.from(String(userId)).toString('base64url');
const resetToken = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH';
const password = 'A-new-strong-password-27';
const account = {
  id: userId,
  username: 'agent1',
  email: 'agent@example.test',
  first_name: 'A',
  last_name: 'Agent',
  is_active: true,
  is_staff: false,
  is_superuser: false,
  role: 'agent',
  phone: '',
  management_permissions: [],
  agent_approved: false,
  agent_onboarding_required: true,
  agent_password_changed: false,
  assigned_city_id: 4,
  assigned_city_name: 'City',
  assigned_city_name_am: 'City Am',
  platform_owner_id: null,
};

function fakePool({ mode = 'active', profile = {} } = {}) {
  const calls = [];
  const state = {
    mode,
    profile: {
      role: 'agent',
      agent_onboarding_required: true,
      agent_password_changed: false,
      assigned_city_id: 4,
      ...profile,
    },
    tokenDigest: 'existing-verification-digest',
    tokenExpires: true,
    invitationDigest: createHash('sha256').update(resetToken).digest('hex'),
    invitationExpired: false,
    sessionDigest: createHash('sha256').update('valid-session-token').digest('hex'),
  };

  const query = async (text, values = []) => {
    calls.push({ text, values });
    const sql = text.trim().replace(/\s+/g, ' ');
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id, email FROM auth_user')) {
      return state.mode === 'active'
        ? { rows: [{ id: userId, email: 'agent@example.test' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT account.id, account.email FROM auth_user')) {
      return state.mode === 'unverified'
        ? { rows: [{ id: userId, email: 'agent@example.test' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT account.id, account.is_active')) {
      return state.mode === 'unverified'
        ? {
          rows: [{
            id: userId,
            is_active: false,
            is_staff: false,
            is_superuser: false,
            email: 'agent@example.test',
            role: 'customer',
          }],
          rowCount: 1,
        }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT account.id, account.username')) {
      return { rows: [{ ...account, ...state.profile }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT session.id AS session_id')) {
      return {
        rows: [{ session_id: 9, user_id: userId }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('SELECT id, email, username, is_active FROM auth_user')) {
      return {
        rows: [{
          id: userId,
          email: 'agent@example.test',
          username: account.username,
          is_active: true,
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('SELECT id, username, email FROM auth_user')) {
      return { rows: [{ id: userId, username: account.username, email: account.email }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM auth_user WHERE id = $1')) {
      return { rows: [{ id: userId }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT role, agent_onboarding_required')) {
      return { rows: [{ ...state.profile }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM accounts_emailverificationtoken')) {
      const matches = values[2] === state.tokenDigest && state.tokenExpires;
      return { rows: matches ? [{ id: 17 }] : [], rowCount: matches ? 1 : 0 };
    }
    if (sql.startsWith('SELECT invitation.id, invitation.user_id')) {
      const matches = values[0] === state.invitationDigest && !state.invitationExpired;
      return {
        rows: matches ? [{ id: 21, user_id: userId, role: state.profile.role }] : [],
        rowCount: matches ? 1 : 0,
      };
    }
    if (sql.startsWith('INSERT INTO accounts_emailverificationtoken')) {
      state.tokenDigest = values[2];
      state.tokenExpires = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE accounts_profile')) {
      if (sql.includes('agent_password_changed = TRUE')) {
        state.profile.agent_password_changed = true;
      }
      if (sql.includes('agent_onboarding_required = FALSE')) {
        state.profile.agent_onboarding_required = false;
        state.profile.agent_approved = true;
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE accounts_delegatedaccountinvitation')) {
      state.invitationExpired = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM accounts_emailverificationtoken')) {
      state.tokenDigest = null;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE auth_user SET is_active = TRUE')) {
      state.mode = 'active';
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT 1 FROM auth_user')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  };

  return {
    calls,
    state,
    connect: async () => ({ query, release() {} }),
    query,
  };
}

async function startServer(pool, options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', accountExtensionsRouter({
    pool,
    sendEmail: async () => {},
    ...options,
  }));
  app.use(errorHandler({ logger: { error() {} } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function post(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('account extensions refuse to mount without a configured email sender', () => {
  assert.throws(
    () => accountExtensionsRouter({ pool: fakePool() }),
    /Configure sendEmail/,
  );
});

test('password reset emails store only a digest and confirmation consumes it', async () => {
  const pool = fakePool();
  const messages = [];
  const { server, baseUrl } = await startServer(pool, {
    sendEmail: async (message) => messages.push(message),
  });
  try {
    const response = await post(baseUrl, '/auth/password-reset/', {
      email: 'agent@example.test',
    });
    assert.equal(response.status, 202);
    const responseBody = await response.json();
    assert.deepEqual(responseBody, {
      detail: 'If an account matches that email, password reset instructions will be sent.',
    });
    assert.equal(JSON.stringify(responseBody).includes(messages[0].token), false);
    assert.equal(messages[0].purpose, 'password_reset');
    assert.ok(messages[0].token);
    assert.ok(pool.calls.some(({ text, values }) => (
      text.includes('INSERT INTO accounts_emailverificationtoken')
      && values[2] === createHash('sha256').update(messages[0].token).digest('hex')
      && values[2] !== messages[0].token
    )));

    const confirmation = await post(baseUrl, '/auth/password-reset/confirm/', {
      uid: messages[0].uid,
      token: messages[0].token,
      password,
      password_confirmation: password,
    });
    assert.equal(confirmation.status, 200);
    assert.ok(pool.calls.some(({ text, values }) => (
      text.startsWith('UPDATE auth_user SET password = $2')
      && values[1].startsWith('pbkdf2_sha256$')
    )));
    assert.ok(pool.calls.some(({ text }) => text.includes('revoked_at = CURRENT_TIMESTAMP')));
    assert.equal(pool.state.tokenDigest, null);

    const reused = await post(baseUrl, '/auth/password-reset/confirm/', {
      uid: messages[0].uid,
      token: messages[0].token,
      password: 'Another-good-password-38',
      password_confirmation: 'Another-good-password-38',
    });
    assert.equal(reused.status, 400);
  } finally {
    await stopServer(server);
  }
});

test('email delivery failures are surfaced and issued tokens are removed', async () => {
  const pool = fakePool();
  const { server, baseUrl } = await startServer(pool, {
    sendEmail: async () => {
      throw new Error('provider unavailable');
    },
  });
  try {
    const response = await post(baseUrl, '/auth/password-reset/', {
      email: 'agent@example.test',
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.message, 'The server encountered an error.');
    assert.equal(pool.state.tokenDigest, null);
  } finally {
    await stopServer(server);
  }
});

test('resend and password-reset requests return the same response for unknown addresses', async () => {
  const pool = fakePool({ mode: 'none' });
  const messages = [];
  const { server, baseUrl } = await startServer(pool, {
    sendEmail: async (message) => messages.push(message),
  });
  try {
    const response = await post(baseUrl, '/auth/password-reset/', { email: 'unknown@example.test' });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      detail: 'If an account matches that email, password reset instructions will be sent.',
    });
    assert.deepEqual(messages[0], {
      to: 'unknown@example.test',
      purpose: 'password_reset',
      uid: null,
      token: null,
    });
  } finally {
    await stopServer(server);
  }
});

test('verification resend, confirmation, and one-time token invalidation work', async () => {
  const pool = fakePool({ mode: 'unverified' });
  const messages = [];
  const { server, baseUrl } = await startServer(pool, {
    sendEmail: async (message) => messages.push(message),
  });
  try {
    const resend = await post(baseUrl, '/auth/verify-email/resend/', {
      email: 'agent@example.test',
    });
    assert.equal(resend.status, 202);
    assert.equal(messages[0].purpose, 'verification');

    pool.state.tokenDigest = createHash('sha256').update(messages[0].token).digest('hex');
    const verified = await post(baseUrl, '/auth/verify-email/', {
      uid: messages[0].uid,
      token: messages[0].token,
    });
    assert.equal(verified.status, 200);
    assert.equal(pool.state.mode, 'active');
    assert.equal(pool.state.tokenDigest, null);
  } finally {
    await stopServer(server);
  }
});

test('invitation acceptance and agent onboarding require and persist the expected transitions', async () => {
  const invitationPool = fakePool({ profile: { role: 'administrator' } });
  const invitationServer = await startServer(invitationPool);
  try {
    const accepted = await post(invitationServer.baseUrl, '/auth/invitations/accept/', {
      token: resetToken,
      password,
    });
    assert.equal(accepted.status, 200);
    assert.ok(invitationPool.calls.some(({ text }) => text.includes('SET accepted_at = CURRENT_TIMESTAMP')));
  } finally {
    await stopServer(invitationServer.server);
  }

  const pool = fakePool();
  const { server, baseUrl } = await startServer(pool);
  try {
    const headers = { Authorization: 'Bearer valid-session-token' };
    const changed = await post(baseUrl, '/auth/agent-onboarding/password/', {
      new_password: password,
      username: 'agent-updated',
    }, headers);
    assert.equal(changed.status, 200);
    assert.equal(pool.state.profile.agent_password_changed, true);
    assert.ok(pool.calls.some(({ text }) => text.includes('id <> $2')));

    const completed = await post(baseUrl, '/auth/agent-onboarding/profile/', {
      first_name: 'Agent',
      last_name: 'Smith',
      email: 'new-agent@example.test',
      phone: '555-0101',
    }, headers);
    assert.equal(completed.status, 200);
    assert.equal(pool.state.profile.agent_onboarding_required, false);
    assert.equal(pool.state.profile.agent_approved, true);
  } finally {
    await stopServer(server);
  }
});

test('one-time endpoints are rate limited', async () => {
  const { server, baseUrl } = await startServer(fakePool(), {
    sendEmail: async () => {},
  });
  try {
    let lastResponse;
    for (let requestNumber = 0; requestNumber < 11; requestNumber += 1) {
      lastResponse = await post(baseUrl, '/auth/password-reset/', {
        email: 'many@example.test',
      });
      await lastResponse.arrayBuffer();
    }
    assert.equal(lastResponse.status, 429);
  } finally {
    await stopServer(server);
  }
});
