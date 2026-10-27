import { registrationSchema } from '../validators/accounts.js';
import { hashPassword } from './passwordService.js';

const ownerLockKey = 68127215;
const ownerLockScope = 2;

export async function bootstrapPlatformOwner(client, {
  username,
  email,
  password,
  apply = false,
}) {
  const input = registrationSchema.safeParse({
    username,
    email,
    password,
    phone: '',
  });
  if (!input.success || password.length < 16) {
    throw new Error(
      'PLATFORM_OWNER_USERNAME, PLATFORM_OWNER_EMAIL, and PLATFORM_OWNER_PASSWORD must satisfy account requirements; the password must be at least 16 characters.',
    );
  }

  const owner = input.data;

  if (apply) {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [ownerLockKey, ownerLockScope]);
  }

  const settings = await client.query(
    `SELECT platform_owner_id
     FROM public.portal_admin_brokeragesettings
     WHERE id = 1${apply ? ' FOR UPDATE' : ''}`,
  );
  if (settings.rowCount > 1) {
    throw new Error('Platform Owner configuration is ambiguous; no changes were made.');
  }

  const matches = await client.query(
    `SELECT account.id, account.username, account.email, account.is_active,
            account.is_staff, account.is_superuser, profile.role
     FROM public.auth_user AS account
     LEFT JOIN public.accounts_profile AS profile ON profile.user_id = account.id
     WHERE lower(account.username) = lower($1)
        OR lower(account.email) = lower($2)
     ORDER BY account.id
     LIMIT 2${apply ? ' FOR UPDATE OF account' : ''}`,
    [owner.username, owner.email],
  );
  if (matches.rowCount > 1) {
    throw new Error('The requested username or email matches multiple accounts; no changes were made.');
  }

  const activeOwners = await client.query(
    `SELECT id
     FROM public.auth_user
     WHERE is_active = TRUE AND is_superuser = TRUE
     ORDER BY id`,
  );
  const configuredOwnerId = settings.rows[0]?.platform_owner_id ?? null;

  if (matches.rowCount === 1) {
    const existing = matches.rows[0];
    const matchesRequestedIdentity = existing.username.toLocaleLowerCase() === owner.username.toLocaleLowerCase()
      && existing.email.toLocaleLowerCase() === owner.email.toLocaleLowerCase();
    const effectiveOwnerId = configuredOwnerId ?? activeOwners.rows[0]?.id ?? null;
    const alreadyConfigured = matchesRequestedIdentity
      && existing.is_active
      && existing.is_staff
      && existing.is_superuser
      && existing.role === 'administrator'
      && String(effectiveOwnerId) === String(existing.id);

    if (alreadyConfigured) {
      return { status: 'already_configured', username: existing.username };
    }
    throw new Error(
      'A user already matches the requested username or email but is not this configured Platform Owner; no changes were made.',
    );
  }

  if (configuredOwnerId !== null || activeOwners.rowCount > 0) {
    throw new Error('A Platform Owner or active superuser already exists; ownership was not changed.');
  }

  if (!apply) return { status: 'ready', username: owner.username };

  const passwordHash = await hashPassword(owner.password);
  const created = await client.query(
    `INSERT INTO public.auth_user
       (password, last_login, is_superuser, username, first_name, last_name,
        email, is_staff, is_active, date_joined)
     VALUES ($1, NULL, TRUE, $2, '', '', $3, TRUE, TRUE, CURRENT_TIMESTAMP)
     RETURNING id`,
    [passwordHash, owner.username, owner.email],
  );
  const userId = created.rows[0]?.id;
  if (userId === undefined) {
    throw new Error('Platform Owner account creation returned no user id; the transaction must be rolled back.');
  }

  await client.query(
    `INSERT INTO public.accounts_profile
       (user_id, role, phone, management_permissions, agent_approved,
        agent_onboarding_required, agent_password_changed, created_at, updated_at)
     VALUES ($1, 'administrator', '', '[]'::jsonb, FALSE, FALSE, TRUE,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [userId],
  );

  if (settings.rowCount === 1) {
    const configured = await client.query(
      `UPDATE public.portal_admin_brokeragesettings
       SET platform_owner_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND platform_owner_id IS NULL`,
      [userId],
    );
    if (configured.rowCount !== 1) {
      throw new Error('Platform Owner assignment did not match the expected empty configuration; the transaction must be rolled back.');
    }
  }

  return { status: 'created', username: owner.username };
}
