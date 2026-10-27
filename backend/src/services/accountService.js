import { createHash, randomBytes } from 'node:crypto';
import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { hashPassword, verifyPassword, verifyUnknownPassword } from './passwordService.js';

const administratorPermissions = [
  'properties.view_all',
  'properties.moderate',
  'properties.edit_all',
  'properties.delete_all',
  'properties.manage_assigned',
  'branding.manage',
  'locations.manage_cities',
  'users.manage',
  'staff.manage',
  'reports.review',
  'audit.view',
  'agents.assign',
  'announcements.review',
  'announcements.assign',
];
const agentPermissions = [
  'properties.manage_assigned',
  'viewings.manage_assigned',
  'locations.manage_subcities',
];

async function getAccount(client, userId) {
  const result = await client.query(
    `SELECT account.id, account.username, account.email, account.first_name, account.last_name,
            account.is_active, account.is_staff, account.is_superuser,
            profile.role, profile.phone, profile.management_permissions,
            profile.agent_approved, profile.agent_onboarding_required,
            profile.agent_password_changed, profile.assigned_city_id,
            city.name AS assigned_city_name, city.name_am AS assigned_city_name_am,
            COALESCE(
              (SELECT settings.platform_owner_id
               FROM portal_admin_brokeragesettings AS settings
               JOIN auth_user AS owner ON owner.id = settings.platform_owner_id
               WHERE settings.id = 1
                 AND owner.is_active = TRUE
                 AND owner.is_superuser = TRUE),
              (SELECT owner.id FROM auth_user AS owner
               WHERE owner.is_active = TRUE AND owner.is_superuser = TRUE
               ORDER BY owner.id LIMIT 1)
            ) AS platform_owner_id
     FROM auth_user AS account
     LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
     LEFT JOIN properties_location AS city ON city.id = profile.assigned_city_id
     WHERE account.id = $1`,
    [userId],
  );
  if (result.rowCount !== 1) throw new ApiError(404, 'Account not found.');

  const row = result.rows[0];
  const isPlatformOwner = Boolean(row.is_active && row.is_superuser && row.platform_owner_id === row.id);
  let permissions = [];
  let role = row.is_superuser || row.is_staff ? 'administrator' : row.role ?? null;

  if (row.is_active && row.is_superuser) {
    permissions = [...administratorPermissions];
    if (isPlatformOwner) permissions.push('settings.manage');
  } else if (row.is_active && row.is_staff && row.role === 'administrator') {
    permissions = [...administratorPermissions];
  } else if (row.is_active && row.role === 'agent' && row.agent_approved) {
    permissions = [...agentPermissions];
    const grantable = Array.isArray(row.management_permissions) ? row.management_permissions : [];
    if (grantable.includes('announcements.review_assigned')) {
      permissions.push('announcements.review_assigned');
    }
    if (grantable.includes('settings.manage')) permissions.push('settings.manage');
  }

  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role,
    phone: row.phone ?? '',
    management_permissions: permissions,
    is_platform_owner: isPlatformOwner,
    agent_onboarding_required: Boolean(row.agent_onboarding_required),
    agent_password_changed: row.agent_password_changed ?? true,
    assigned_city_id: row.assigned_city_id === null ? null : Number(row.assigned_city_id),
    assigned_city_name: row.assigned_city_name,
    assigned_city_name_am: row.assigned_city_name_am,
  };
}

async function findLoginUser(client, identifier) {
  if (identifier.includes('@')) {
    const byEmail = await client.query(
      'SELECT id, password FROM auth_user WHERE lower(email) = lower($1) ORDER BY id LIMIT 2',
      [identifier],
    );
    return byEmail.rows;
  }

  const byPhone = await client.query(
    `SELECT DISTINCT account.id, account.password
     FROM auth_user AS account
     JOIN accounts_profile AS profile ON profile.user_id = account.id
     WHERE lower(profile.phone) = lower($1)
     ORDER BY account.id
     LIMIT 2`,
    [identifier],
  );
  if (byPhone.rowCount > 0) return byPhone.rows;

  const byUsername = await client.query(
    'SELECT id, password FROM auth_user WHERE lower(username) = lower($1) ORDER BY id LIMIT 2',
    [identifier],
  );
  return byUsername.rows;
}

export async function login(pool, identifier, password) {
  return withTransaction(pool, async (client) => {
    const matches = await findLoginUser(client, identifier);
    if (matches.length !== 1) {
      await verifyUnknownPassword(password);
      throw new ApiError(400, 'Invalid username or password.');
    }
    if (!(await verifyPassword(password, matches[0].password))) {
      throw new ApiError(400, 'Invalid username or password.');
    }

    const user = await client.query('SELECT is_active FROM auth_user WHERE id = $1', [matches[0].id]);
    if (user.rows[0]?.is_active !== true) throw new ApiError(400, 'Invalid username or password.');
    const account = await getAccount(client, matches[0].id);
    const token = randomBytes(32).toString('base64url');
    const tokenDigest = createHash('sha256').update(token, 'utf8').digest('hex');

    await client.query(
      `INSERT INTO accounts_tabsessiontoken (user_id, token_digest, created_at, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '14 days')`,
      [matches[0].id, tokenDigest],
    );
    return { account, sessionToken: token };
  });
}

export async function register(pool, data) {
  const password = await hashPassword(data.password);
  return withTransaction(pool, async (client) => {
    for (const value of [data.username, data.email].map((entry) => entry.toLocaleLowerCase()).sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [value]);
    }
    const duplicate = await client.query(
      `SELECT username, email FROM auth_user
       WHERE lower(username) = lower($1) OR lower(email) = lower($2)
       LIMIT 1`,
      [data.username, data.email],
    );
    if (duplicate.rowCount) {
      const existing = duplicate.rows[0];
      const isUsernameDuplicate = existing.username.toLocaleLowerCase()
        === data.username.toLocaleLowerCase();
      const field = isUsernameDuplicate ? 'username' : 'email';
      const message = isUsernameDuplicate
        ? 'A user with this username already exists.'
        : 'A user with this email already exists.';
      throw new ApiError(400, 'Request validation failed.', {
        [field]: [message],
      });
    }

    const created = await client.query(
      `INSERT INTO auth_user
         (password, last_login, is_superuser, username, first_name, last_name,
          email, is_staff, is_active, date_joined)
       VALUES ($1, NULL, FALSE, $2, '', '', $3, FALSE, TRUE, CURRENT_TIMESTAMP)
       RETURNING id`,
      [password, data.username, data.email],
    );
    await client.query(
      `INSERT INTO accounts_profile (user_id, role, phone, management_permissions,
                                     agent_approved, agent_onboarding_required,
                                     agent_password_changed, created_at, updated_at)
       VALUES ($1, 'customer', $2, '[]'::jsonb, FALSE, FALSE, TRUE,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [created.rows[0].id, data.phone],
    );
    return getAccount(client, created.rows[0].id);
  });
}

function accountUid(userId) {
  return Buffer.from(String(userId), 'utf8').toString('base64url');
}

function userIdFromUid(uid) {
  try {
    const decoded = Buffer.from(uid, 'base64url').toString('utf8');
    if (!/^[1-9]\d*$/.test(decoded) || accountUid(decoded) !== uid) return null;
    return decoded;
  } catch {
    return null;
  }
}

function invalidToken(message) {
  return new ApiError(400, message);
}

function validatePasswordForAccount(password, account) {
  const candidate = password.toLocaleLowerCase();
  const identifiers = [
    account.username,
    account.email?.split('@')[0],
  ].filter((value) => typeof value === 'string' && value.length >= 3);
  if (/^\d+$/.test(password)) {
    throw new ApiError(400, 'Request validation failed.', {
      password: ['The password cannot be entirely numeric.'],
    });
  }
  if (identifiers.some((value) => candidate.includes(value.toLocaleLowerCase()))) {
    throw new ApiError(400, 'Request validation failed.', {
      password: ['The password is too similar to account information.'],
    });
  }
}

export async function requestAccountEmail(pool, email, purpose, sendEmail) {
  if (typeof sendEmail !== 'function') {
    throw new ApiError(503, 'Email delivery is not configured.');
  }

  const message = await withTransaction(pool, async (client) => {
    const result = purpose === 'verification'
      ? await client.query(
        `SELECT account.id, account.email
         FROM auth_user AS account
         JOIN accounts_profile AS profile ON profile.user_id = account.id
         WHERE lower(account.email) = lower($1)
           AND account.is_active = FALSE
           AND account.is_staff = FALSE
           AND account.is_superuser = FALSE
           AND profile.role = 'customer'
         ORDER BY account.id LIMIT 1`,
        [email],
      )
      : await client.query(
        `SELECT id, email FROM auth_user
         WHERE lower(email) = lower($1) AND is_active = TRUE
         ORDER BY id LIMIT 1`,
        [email],
      );
    const account = result.rows[0];
    if (!account) return { to: email, purpose, uid: null, token: null, digest: null };

    const token = randomBytes(32).toString('base64url');
    const digest = createHash('sha256').update(token, 'utf8').digest('hex');
    await client.query(
      'DELETE FROM accounts_emailverificationtoken WHERE user_id = $1',
      [account.id],
    );
    await client.query(
      `INSERT INTO accounts_emailverificationtoken
         (user_id, email, token_digest, created_at, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP + $4::interval)`,
      [
        account.id,
        account.email,
        digest,
        purpose === 'verification' ? '1 day' : '1 hour',
      ],
    );
    return {
      to: email,
      purpose,
      uid: accountUid(account.id),
      token,
      digest,
    };
  });

  try {
    await sendEmail({
      to: message.to,
      purpose: message.purpose,
      uid: message.uid,
      token: message.token,
    });
  } catch {
    if (message.digest) {
      await pool.query(
        'DELETE FROM accounts_emailverificationtoken WHERE token_digest = $1',
        [message.digest],
      );
    }
    throw new ApiError(503, 'Email delivery is temporarily unavailable.');
  }
}

export async function verifyAccountEmail(pool, uid, token) {
  const userId = userIdFromUid(uid);
  if (!userId) throw invalidToken('This verification link is invalid or expired.');
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');

  return withTransaction(pool, async (client) => {
    const user = await client.query(
      `SELECT account.id, account.is_active, account.is_staff, account.is_superuser,
              account.email, profile.role
       FROM auth_user AS account
       JOIN accounts_profile AS profile ON profile.user_id = account.id
       WHERE account.id = $1 FOR UPDATE OF account, profile`,
      [userId],
    );
    const row = user.rows[0];
    if (!row || row.is_active || row.is_staff || row.is_superuser || row.role !== 'customer') {
      throw invalidToken('This verification link is invalid or expired.');
    }
    const matching = await client.query(
      `SELECT id FROM accounts_emailverificationtoken
       WHERE user_id = $1 AND email = $2 AND token_digest = $3
         AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [row.id, row.email, digest],
    );
    if (!matching.rowCount) throw invalidToken('This verification link is invalid or expired.');

    await client.query('UPDATE auth_user SET is_active = TRUE WHERE id = $1', [row.id]);
    await client.query(
      'DELETE FROM accounts_emailverificationtoken WHERE user_id = $1',
      [row.id],
    );
    return { detail: 'Your email address is verified. You can now sign in.' };
  });
}

export async function confirmPasswordReset(pool, uid, token, password) {
  const userId = userIdFromUid(uid);
  if (!userId) throw invalidToken('This password reset link is invalid or expired.');
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');

  return withTransaction(pool, async (client) => {
    const user = await client.query(
      'SELECT id, email, username, is_active FROM auth_user WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const row = user.rows[0];
    if (!row || !row.is_active) {
      throw invalidToken('This password reset link is invalid or expired.');
    }
    const matching = await client.query(
      `SELECT id FROM accounts_emailverificationtoken
       WHERE user_id = $1 AND email = $2 AND token_digest = $3
         AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [row.id, row.email, digest],
    );
    if (!matching.rowCount) throw invalidToken('This password reset link is invalid or expired.');

    validatePasswordForAccount(password, row);
    const encodedPassword = await hashPassword(password);
    await client.query('UPDATE auth_user SET password = $2 WHERE id = $1', [row.id, encodedPassword]);
    await client.query(
      `UPDATE accounts_tabsessiontoken SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.id],
    );
    await client.query(
      'DELETE FROM accounts_emailverificationtoken WHERE user_id = $1',
      [row.id],
    );
    return { detail: 'Your password has been changed. You can now sign in.' };
  });
}

export async function acceptDelegatedInvitation(pool, token, password) {
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');

  return withTransaction(pool, async (client) => {
    const invitation = await client.query(
      `SELECT invitation.id, invitation.user_id, profile.role,
              account.username, account.email
       FROM accounts_delegatedaccountinvitation AS invitation
       JOIN auth_user AS account ON account.id = invitation.user_id
       JOIN accounts_profile AS profile ON profile.user_id = account.id
       WHERE invitation.token_digest = $1
         AND invitation.accepted_at IS NULL
         AND invitation.expires_at > CURRENT_TIMESTAMP
         AND account.is_active = FALSE
       FOR UPDATE OF invitation, account, profile`,
      [digest],
    );
    const row = invitation.rows[0];
    if (!row) {
      throw invalidToken('This invitation is invalid, expired, or already used.');
    }

    validatePasswordForAccount(password, row);
    const encodedPassword = await hashPassword(password);
    await client.query(
      `UPDATE auth_user SET password = $2, is_active = TRUE WHERE id = $1`,
      [row.user_id, encodedPassword],
    );
    if (row.role === 'agent') {
      await client.query(
        `UPDATE accounts_profile
         SET agent_approved = FALSE, agent_onboarding_required = TRUE,
             agent_password_changed = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [row.user_id],
      );
    }
    await client.query(
      `UPDATE accounts_delegatedaccountinvitation
       SET accepted_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id],
    );
    return getAccount(client, row.user_id);
  });
}

async function lockAgentOnboardingProfile(client, userId) {
  const result = await client.query(
    `SELECT role, agent_onboarding_required, agent_password_changed, assigned_city_id
     FROM accounts_profile WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  return result.rows[0];
}

export async function updateAgentOnboardingPassword(pool, userId, sessionId, data) {
  return withTransaction(pool, async (client) => {
    const user = await client.query(
      'SELECT id, username, email FROM auth_user WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const profile = await lockAgentOnboardingProfile(client, userId);
    if (
      !user.rowCount || !profile || profile.role !== 'agent'
      || !profile.agent_onboarding_required || profile.agent_password_changed
    ) {
      throw invalidToken('This account is not waiting for its initial password change.');
    }

    validatePasswordForAccount(data.new_password, {
      username: data.username || user.rows[0].username,
      email: user.rows[0].email,
    });

    if (data.username) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))',
        [data.username],
      );
      const duplicate = await client.query(
        'SELECT 1 FROM auth_user WHERE lower(username) = lower($1) AND id <> $2 LIMIT 1',
        [data.username, userId],
      );
      if (duplicate.rowCount) {
        throw new ApiError(400, 'Request validation failed.', {
          username: ['A user with this username already exists.'],
        });
      }
    }

    const encodedPassword = await hashPassword(data.new_password);
    await client.query(
      'UPDATE auth_user SET username = COALESCE($2, username), password = $3 WHERE id = $1',
      [userId, data.username || null, encodedPassword],
    );
    await client.query(
      `UPDATE accounts_profile SET agent_password_changed = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE accounts_tabsessiontoken SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`,
      [userId, sessionId],
    );
    return getAccount(client, userId);
  });
}

export async function updateAgentOnboardingProfile(pool, userId, data) {
  return withTransaction(pool, async (client) => {
    const user = await client.query(
      'SELECT id FROM auth_user WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const profile = await lockAgentOnboardingProfile(client, userId);
    if (
      !user.rowCount || !profile || profile.role !== 'agent'
      || !profile.agent_onboarding_required || !profile.agent_password_changed
    ) {
      throw invalidToken('Change the initial password before completing your agent profile.');
    }
    if (profile.assigned_city_id === null) {
      throw new ApiError(400, 'Contact an administrator to assign your city before completing agent setup.');
    }

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))',
      [data.email],
    );
    const duplicate = await client.query(
      'SELECT 1 FROM auth_user WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1',
      [data.email, userId],
    );
    if (duplicate.rowCount) {
      throw new ApiError(400, 'Request validation failed.', {
        email: ['A user with this email already exists.'],
      });
    }

    await client.query(
      `UPDATE auth_user SET first_name = $2, last_name = $3, email = $4
       WHERE id = $1`,
      [userId, data.first_name, data.last_name, data.email],
    );
    await client.query(
      `UPDATE accounts_profile
       SET phone = $2, agent_onboarding_required = FALSE, agent_approved = TRUE,
           management_permissions = '["properties.manage_assigned","viewings.manage_assigned","locations.manage_subcities"]'::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId, data.phone],
    );
    return getAccount(client, userId);
  });
}

export async function getAuthenticatedAccount(pool, userId) {
  return getAccount(pool, userId);
}

export async function updateAccount(pool, userId, patch) {
  return withTransaction(pool, async (client) => {
    if (patch.email !== undefined) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))', [patch.email]);
      const duplicate = await client.query(
        'SELECT 1 FROM auth_user WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1',
        [patch.email, userId],
      );
      if (duplicate.rowCount) {
        throw new ApiError(400, 'Request validation failed.', {
          email: ['A user with this email already exists.'],
        });
      }
    }

    await client.query(
      `UPDATE auth_user
       SET email = COALESCE($2, email),
           first_name = COALESCE($3, first_name),
           last_name = COALESCE($4, last_name)
       WHERE id = $1`,
      [userId, patch.email ?? null, patch.first_name ?? null, patch.last_name ?? null],
    );
    if (patch.phone !== undefined) {
      await client.query(
        `INSERT INTO accounts_profile (user_id, role, phone, management_permissions,
                                       agent_approved, agent_onboarding_required,
                                       agent_password_changed, created_at, updated_at)
         VALUES ($1, 'customer', $2, '[]'::jsonb, FALSE, FALSE, TRUE,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE
         SET phone = EXCLUDED.phone, updated_at = CURRENT_TIMESTAMP`,
        [userId, patch.phone],
      );
    }
    return getAccount(client, userId);
  });
}

export async function revokeSession(pool, sessionId) {
  await pool.query(
    `UPDATE accounts_tabsessiontoken
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

export async function getPreferences(pool, userId) {
  await pool.query(
    `INSERT INTO accounts_userpreferences
       (user_id, theme, locale, density, reduced_motion, created_at, updated_at)
     VALUES ($1, 'system', 'en', 'comfortable', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const result = await pool.query(
    `SELECT theme, locale, density, reduced_motion
     FROM accounts_userpreferences WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? {
    theme: 'system',
    locale: 'en',
    density: 'comfortable',
    reduced_motion: false,
  };
}

export async function updatePreferences(pool, userId, patch, reset = false) {
  const preferences = reset
    ? { theme: 'system', locale: 'en', density: 'comfortable', reduced_motion: false }
    : { ...await getPreferences(pool, userId), ...patch };
  await pool.query(
    `INSERT INTO accounts_userpreferences
       (user_id, theme, locale, density, reduced_motion, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE
     SET theme = EXCLUDED.theme, locale = EXCLUDED.locale,
         density = EXCLUDED.density, reduced_motion = EXCLUDED.reduced_motion,
         updated_at = CURRENT_TIMESTAMP`,
    [userId, preferences.theme, preferences.locale, preferences.density, preferences.reduced_motion],
  );
  return preferences;
}

export async function accountActivity(pool, userId) {
  const [favorites, viewingRequests] = await Promise.all([
    pool.query(
      `SELECT favorite.id, favorite.created_at,
              property.id AS property_id, property.title, property.slug,
              property.listing_type, property.status
       FROM favorites_favorite AS favorite
       JOIN user_property AS property ON property.id = favorite.property_id
       WHERE favorite.user_id = $1
       ORDER BY favorite.created_at DESC`,
      [userId],
    ),
    pool.query(
      `SELECT request.id, request.status, request.preferred_date,
              request.preferred_time, request.scheduled_date,
              request.scheduled_time, request.created_at,
              property.id AS property_id, property.title, property.slug,
              property.listing_type, property.status AS property_status
       FROM user_viewingrequest AS request
       JOIN user_property AS property ON property.id = request.property_id
       LEFT JOIN accounts_profile AS profile ON profile.user_id = request.requester_id
       WHERE request.requester_id = $1
         AND request.requester_deleted_at IS NULL
         AND COALESCE(profile.role, 'customer') <> 'agent'
       ORDER BY request.created_at DESC`,
      [userId],
    ),
  ]);
  return {
    favorites: favorites.rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      property: {
        id: row.property_id,
        title: row.title,
        slug: row.slug,
        listing_type: row.listing_type,
        status: row.status,
      },
    })),
    viewing_requests: viewingRequests.rows.map((row) => ({
      id: row.id,
      status: row.status,
      preferred_date: row.preferred_date,
      preferred_time: row.preferred_time,
      scheduled_date: row.scheduled_date,
      scheduled_time: row.scheduled_time,
      created_at: row.created_at,
      property: {
        id: row.property_id,
        title: row.title,
        slug: row.slug,
        listing_type: row.listing_type,
        status: row.property_status,
      },
    })),
  };
}
