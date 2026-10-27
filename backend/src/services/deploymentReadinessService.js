import { access, constants, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { getSmtpConfiguration } from './emailService.js';

const requiredTables = [
  'auth_user',
  'accounts_profile',
  'accounts_tabsessiontoken',
  'accounts_userpreferences',
  'user_property',
  'user_propertyimage',
  'properties_amenity',
  'properties_location',
  'backend_media_file_metadata',
];
const requiredColumns = [
  ['user_property', 'currency'],
  ['user_property', 'price'],
];
const requiredNullableColumns = [
  ['user_property', 'price'],
];

const requiredPrivileges = [
  ['auth_user', 'SELECT'],
  ['auth_user', 'INSERT'],
  ['auth_user', 'UPDATE'],
  ['accounts_profile', 'SELECT'],
  ['accounts_profile', 'INSERT'],
  ['accounts_profile', 'UPDATE'],
  ['accounts_tabsessiontoken', 'SELECT'],
  ['accounts_tabsessiontoken', 'INSERT'],
  ['accounts_tabsessiontoken', 'UPDATE'],
  ['accounts_tabsessiontoken', 'DELETE'],
  ['accounts_userpreferences', 'SELECT'],
  ['accounts_userpreferences', 'INSERT'],
  ['accounts_userpreferences', 'UPDATE'],
  ['user_property', 'SELECT'],
  ['user_property', 'INSERT'],
  ['user_property', 'UPDATE'],
  ['user_property', 'DELETE'],
  ['user_propertyimage', 'SELECT'],
  ['user_propertyimage', 'INSERT'],
  ['user_propertyimage', 'UPDATE'],
  ['user_propertyimage', 'DELETE'],
  ['properties_amenity', 'SELECT'],
  ['properties_location', 'SELECT'],
  ['backend_media_file_metadata', 'SELECT'],
  ['backend_media_file_metadata', 'INSERT'],
  ['backend_media_file_metadata', 'UPDATE'],
  ['backend_media_file_metadata', 'DELETE'],
];

function isWithinDirectory(directory, target) {
  const relative = path.relative(directory, target);
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

async function inspectMediaRoot(root, applicationRoot) {
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') {
      return {
        exists: error.code !== 'ENOENT',
        is_directory: false,
        writable: false,
        outside_application: !isWithinDirectory(applicationRoot, root),
        canonical_path: null,
      };
    }
    throw error;
  }

  const info = await stat(canonicalRoot);
  let writable = false;
  if (info.isDirectory()) {
    try {
      await access(canonicalRoot, constants.W_OK);
      writable = true;
    } catch (error) {
      if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    }
  }
  return {
    exists: true,
    is_directory: info.isDirectory(),
    writable,
    outside_application: !isWithinDirectory(applicationRoot, canonicalRoot),
    canonical_path: canonicalRoot,
  };
}

export async function checkDeploymentReadiness({
  pool,
  mediaConfig,
  applicationRoot,
  environment = process.env,
}) {
  const blockers = [];
  const warnings = [];
  const email = getSmtpConfiguration(environment);
  const publicRoot = path.resolve(mediaConfig.publicRoot);
  const privateRoot = path.resolve(mediaConfig.privateRoot);
  const resolvedApplicationRoot = path.resolve(applicationRoot);
  const publicMedia = await inspectMediaRoot(publicRoot, resolvedApplicationRoot);
  const privateMedia = await inspectMediaRoot(privateRoot, resolvedApplicationRoot);
  const canonicalPublicRoot = publicMedia.canonical_path || publicRoot;
  const canonicalPrivateRoot = privateMedia.canonical_path || privateRoot;

  if (environment.NODE_ENV !== 'production') {
    blockers.push('NODE_ENV must be production for a production deployment check.');
  }
  if (!email.configuration) {
    blockers.push(`SMTP email delivery is not configured: ${email.errors.join('; ')}.`);
  }
  if (canonicalPublicRoot === canonicalPrivateRoot
    || isWithinDirectory(canonicalPublicRoot, canonicalPrivateRoot)
    || isWithinDirectory(canonicalPrivateRoot, canonicalPublicRoot)) {
    blockers.push('Public and private media roots must be separate directories.');
  }
  for (const [name, media] of [['MEDIA_ROOT', publicMedia], ['PRIVATE_MEDIA_ROOT', privateMedia]]) {
    if (!media.exists || !media.is_directory) {
      blockers.push(`${name} must be an existing directory on the deployment host.`);
    }
    if (!media.writable) blockers.push(`${name} must be writable by the Node process.`);
    if (!media.outside_application) {
      blockers.push(`${name} must be outside the application release directory.`);
    }
  }

  const schema = environment.PGSCHEMA?.trim() || 'public';
  const databaseResult = await pool.query(
    `SELECT current_database() AS database_name,
            current_user AS database_user,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('transaction_read_only') AS transaction_read_only,
            current_schemas(true) AS search_path_schemas,
            role.rolsuper AS is_superuser
     FROM pg_roles AS role
     WHERE role.rolname = current_user`,
  );
  const database = databaseResult.rows[0];
  if (!database) throw new Error('Unable to inspect the connected PostgreSQL role.');

  const version = Number(database.server_version_num);
  if (!Number.isInteger(version) || version < 130000) {
    blockers.push('PostgreSQL 13 or newer is required by this deployment configuration.');
  }
  if (Number.isInteger(version) && version >= 130000 && version < 140000) {
    warnings.push(
      'PostgreSQL 13 is end-of-life upstream. Its use is a temporary HahuCloud compatibility exception, not confirmed support; verify against an isolated PostgreSQL 13.23 instance and upgrade to a supported major version as soon as possible.',
    );
  }
  if (database.transaction_read_only === 'on') {
    blockers.push('The application database role is read-only; application workflows require writes.');
  }
  if (database.is_superuser) {
    blockers.push('The application must not connect with a PostgreSQL superuser role.');
  }
  if (!database.search_path_schemas.includes('public')
    || !database.search_path_schemas.includes(schema)) {
    blockers.push('The PostgreSQL search_path must include public and the configured application schema.');
  }

  const tablesResult = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_name = ANY($2::text[])
       AND table_type = 'BASE TABLE'`,
    [schema, requiredTables],
  );
  const presentTables = new Set(tablesResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !presentTables.has(table));
  if (missingTables.length > 0) {
    blockers.push(`Existing database schema is missing required tables: ${missingTables.join(', ')}.`);
  }
  const columnsResult = await pool.query(
    `SELECT table_name, column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = ANY($2::text[])
       AND column_name = ANY($3::text[])`,
    [
      schema,
      requiredColumns.map(([table]) => table),
      requiredColumns.map(([, column]) => column),
    ],
  );
  const presentColumns = new Set(
    columnsResult.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
  );
  const nullableColumns = new Set(
    columnsResult.rows
      .filter(({ is_nullable }) => is_nullable === 'YES')
      .map(({ table_name, column_name }) => `${table_name}.${column_name}`),
  );
  const missingColumns = requiredColumns
    .filter(([table, column]) => !presentColumns.has(`${table}.${column}`))
    .map(([table, column]) => `${table}.${column}`);
  if (missingColumns.length > 0) {
    blockers.push(`Existing database schema is missing required columns: ${missingColumns.join(', ')}.`);
  }
  const nonNullableColumns = requiredNullableColumns
    .filter(([table, column]) => !nullableColumns.has(`${table}.${column}`))
    .map(([table, column]) => `${table}.${column}`);
  if (nonNullableColumns.length > 0) {
    blockers.push(`Existing database columns must allow NULL values: ${nonNullableColumns.join(', ')}.`);
  }
  const privilegesResult = await pool.query(
    `SELECT required.table_name, required.privilege
     FROM unnest($2::text[], $3::text[]) AS required(table_name, privilege)
     JOIN information_schema.tables AS existing
       ON existing.table_name = required.table_name
      AND existing.table_schema = $1
      AND existing.table_type = 'BASE TABLE'
     WHERE NOT has_table_privilege(
       current_user,
       format('%I.%I', existing.table_schema, existing.table_name),
       required.privilege
     )`,
    [
      schema,
      requiredPrivileges.map(([table]) => table),
      requiredPrivileges.map(([, privilege]) => privilege),
    ],
  );
  if (privilegesResult.rows.length > 0) {
    const missing = privilegesResult.rows
      .map(({ table_name, privilege }) => `${table_name}:${privilege}`)
      .join(', ');
    blockers.push(`Application role is missing table privileges: ${missing}.`);
  }

  if (mediaConfig.capacityBytes === null) {
    warnings.push('MEDIA_CAPACITY_BYTES is unset; configured media quota cannot be monitored.');
  }
  warnings.push(
    'Confirm with HahuCloud that both media directories are persistent across restarts and releases; this check cannot prove persistence.',
  );

  return {
    ready: blockers.length === 0,
    database: {
      name: database.database_name,
      user: database.database_user,
      server_version_num: version,
      schema,
      missing_required_tables: missingTables,
      missing_required_columns: missingColumns,
      non_nullable_required_columns: nonNullableColumns,
      missing_table_privileges: privilegesResult.rows.map(
        ({ table_name, privilege }) => `${table_name}:${privilege}`,
      ),
      is_superuser: database.is_superuser,
      transaction_read_only: database.transaction_read_only === 'on',
    },
    media: {
      public: { path: publicRoot, ...publicMedia },
      private: { path: privateRoot, ...privateMedia },
    },
    blockers,
    warnings,
  };
}
