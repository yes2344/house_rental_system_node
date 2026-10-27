const minimumSupportedVersion = 130000;
const metadataTable = 'public.backend_media_file_metadata';
const historyTable = 'public.backend_schema_migrations';

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function inspectTarget(client, migrationName, checksum, { requireWritable }) {
  const connection = await client.query(
    `SELECT current_database() AS database_name,
            current_user AS database_user,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('transaction_read_only') AS transaction_read_only,
            role.rolsuper AS is_superuser
     FROM pg_roles AS role
     WHERE role.rolname = current_user`,
  );
  const target = connection.rows[0];
  if (!target) throw new Error('Unable to inspect the connected PostgreSQL role.');
  if (target.server_version_num < minimumSupportedVersion) {
    throw new Error('PostgreSQL 13 or newer is required; upgrade the target before migrating.');
  }
  if (requireWritable && target.transaction_read_only === 'on') {
    throw new Error('The connected role is read-only and cannot apply schema migrations.');
  }
  if (target.is_superuser) {
    throw new Error('Use a dedicated non-superuser migration role.');
  }

  const imageTable = await client.query(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_propertyimage'
       AND column_name = 'id'`,
  );
  if (imageTable.rows[0]?.data_type !== 'bigint') {
    throw new Error('Expected public.user_propertyimage.id to exist as bigint.');
  }
  const privileges = await client.query(
    `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
            has_table_privilege(
              current_user,
              'public.user_propertyimage',
              'REFERENCES'
            ) AS can_reference`,
  );
  if (!privileges.rows[0]?.can_create) {
    throw new Error('The migration role needs CREATE privilege on the public schema.');
  }
  if (!privileges.rows[0]?.can_reference) {
    throw new Error('The migration role needs REFERENCES privilege on public.user_propertyimage.');
  }

  const existingRelations = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS history_exists,
            to_regclass($2) IS NOT NULL AS metadata_exists`,
    [historyTable, metadataTable],
  );
  const { history_exists: historyExists, metadata_exists: metadataExists } = existingRelations.rows[0];
  let applied = null;
  if (historyExists) {
    const history = await client.query(
      `SELECT checksum
       FROM public.backend_schema_migrations
       WHERE migration_name = $1`,
      [migrationName],
    );
    applied = history.rows[0] ?? null;
    if (applied && applied.checksum !== checksum) {
      throw new Error(`Checksum mismatch for already-applied migration ${migrationName}.`);
    }
    if (applied && !metadataExists) {
      throw new Error(
        `Migration history records ${migrationName}, but ${metadataTable} is missing.`,
      );
    }
  }
  if (!applied && metadataExists) {
    throw new Error(
      'The media metadata table exists without a migration record; inspect it manually before proceeding.',
    );
  }

  return {
    target: {
      database: target.database_name,
      server_version_num: target.server_version_num,
    },
    historyExists,
    applied: Boolean(applied),
  };
}

export async function runMediaMetadataMigration(client, {
  migrationName,
  sql,
  checksum,
  applicationRole,
  apply = false,
}) {
  if (apply) {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(68127215, 1)');
      const current = await inspectTarget(client, migrationName, checksum, { requireWritable: true });
      if (current.applied) {
        await client.query('COMMIT');
        return { ...current, status: 'already_applied' };
      }
      if (!current.historyExists) {
        await client.query(
          `CREATE TABLE public.backend_schema_migrations (
             migration_name text PRIMARY KEY,
             checksum text NOT NULL,
             applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
           )`,
        );
      }
      await client.query(sql);
      if (applicationRole) {
        await client.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE
           ON public.backend_media_file_metadata
           TO ${quoteIdentifier(applicationRole)}`,
        );
      }
      await client.query(
        `INSERT INTO public.backend_schema_migrations (migration_name, checksum)
         VALUES ($1, $2)`,
        [migrationName, checksum],
      );
      await client.query('COMMIT');
      return { ...current, historyExists: true, status: 'applied' };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  const current = await inspectTarget(client, migrationName, checksum, { requireWritable: false });
  return {
    ...current,
    status: current.applied ? 'already_applied' : 'pending',
  };
}

async function inspectPropertyCurrencyTarget(client, migrationName, checksum, { requireWritable }) {
  const connection = await client.query(
    `SELECT current_database() AS database_name,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('transaction_read_only') AS transaction_read_only,
            role.rolsuper AS is_superuser
     FROM pg_roles AS role
     WHERE role.rolname = current_user`,
  );
  const target = connection.rows[0];
  if (!target) throw new Error('Unable to inspect the connected PostgreSQL role.');
  if (target.server_version_num < minimumSupportedVersion) {
    throw new Error('PostgreSQL 13 or newer is required; upgrade the target before migrating.');
  }
  if (requireWritable && target.transaction_read_only === 'on') {
    throw new Error('The connected role is read-only and cannot apply schema migrations.');
  }
  if (target.is_superuser) throw new Error('Use a dedicated non-superuser migration role.');

  const relations = await client.query(
    `SELECT to_regclass('public.backend_schema_migrations') IS NOT NULL AS history_exists,
            to_regclass('public.user_property') IS NOT NULL AS property_exists`,
  );
  const { history_exists: historyExists, property_exists: propertyExists } = relations.rows[0];
  if (!propertyExists) throw new Error('Expected public.user_property to exist.');

  const currencyColumn = await client.query(
    `SELECT data_type, character_maximum_length, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_property'
       AND column_name = 'currency'`,
  );
  const currencyExists = currencyColumn.rowCount > 0;
  let applied = null;
  if (historyExists) {
    const history = await client.query(
      `SELECT checksum
       FROM public.backend_schema_migrations
       WHERE migration_name = $1`,
      [migrationName],
    );
    applied = history.rows[0] ?? null;
    if (applied && applied.checksum !== checksum) {
      throw new Error(`Checksum mismatch for already-applied migration ${migrationName}.`);
    }
  }
  if (applied && !currencyExists) {
    throw new Error('Migration history records the property currency migration, but its column is missing.');
  }
  if (!applied && currencyExists) {
    throw new Error('The property currency column exists without a migration record; inspect it manually.');
  }

  return {
    target: {
      database: target.database_name,
      server_version_num: target.server_version_num,
    },
    historyExists,
    applied: Boolean(applied),
  };
}

export async function runPropertyCurrencyMigration(client, {
  migrationName,
  sql,
  checksum,
  apply = false,
}) {
  if (apply) {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(68127215, 2)');
      const current = await inspectPropertyCurrencyTarget(
        client,
        migrationName,
        checksum,
        { requireWritable: true },
      );
      if (current.applied) {
        await client.query('COMMIT');
        return { ...current, status: 'already_applied' };
      }
      if (!current.historyExists) {
        await client.query(
          `CREATE TABLE public.backend_schema_migrations (
             migration_name text PRIMARY KEY,
             checksum text NOT NULL,
             applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
           )`,
        );
      }
      await client.query(sql);
      await client.query(
        `INSERT INTO public.backend_schema_migrations (migration_name, checksum)
         VALUES ($1, $2)`,
        [migrationName, checksum],
      );
      await client.query('COMMIT');
      return { ...current, historyExists: true, status: 'applied' };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  const current = await inspectPropertyCurrencyTarget(
    client,
    migrationName,
    checksum,
    { requireWritable: false },
  );
  return {
    ...current,
    status: current.applied ? 'already_applied' : 'pending',
  };
}

async function inspectPropertyPriceTarget(client, migrationName, checksum, { requireWritable }) {
  const connection = await client.query(
    `SELECT current_database() AS database_name,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('transaction_read_only') AS transaction_read_only,
            role.rolsuper AS is_superuser
     FROM pg_roles AS role
     WHERE role.rolname = current_user`,
  );
  const target = connection.rows[0];
  if (!target) throw new Error('Unable to inspect the connected PostgreSQL role.');
  if (target.server_version_num < minimumSupportedVersion) {
    throw new Error('PostgreSQL 13 or newer is required; upgrade the target before migrating.');
  }
  if (requireWritable && target.transaction_read_only === 'on') {
    throw new Error('The connected role is read-only and cannot apply schema migrations.');
  }
  if (target.is_superuser) throw new Error('Use a dedicated non-superuser migration role.');

  const property = await client.query(
    `SELECT to_regclass('public.user_property') IS NOT NULL AS property_exists`,
  );
  if (!property.rows[0]?.property_exists) throw new Error('Expected public.user_property to exist.');

  const priceColumn = await client.query(
    `SELECT data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_property'
       AND column_name = 'price'`,
  );
  if (priceColumn.rowCount !== 1 || priceColumn.rows[0].data_type !== 'numeric') {
    throw new Error('Expected public.user_property.price to exist as numeric.');
  }
  const priceIsNullable = priceColumn.rows[0].is_nullable === 'YES';
  const priceConstraint = await client.query(
    `SELECT 1
     FROM pg_constraint
     WHERE conrelid = 'public.user_property'::regclass
       AND conname = 'property_price_positive'
       AND contype = 'c'`,
  );
  if (!priceConstraint.rowCount) {
    throw new Error('Expected the property_price_positive constraint to exist.');
  }

  const history = await client.query(
    `SELECT to_regclass('public.backend_schema_migrations') IS NOT NULL AS history_exists`,
  );
  const historyExists = history.rows[0].history_exists;
  let applied = null;
  if (historyExists) {
    const record = await client.query(
      `SELECT checksum
       FROM public.backend_schema_migrations
       WHERE migration_name = $1`,
      [migrationName],
    );
    applied = record.rows[0] ?? null;
    if (applied && applied.checksum !== checksum) {
      throw new Error(`Checksum mismatch for already-applied migration ${migrationName}.`);
    }
  }
  if (applied && !priceIsNullable) {
    throw new Error('Migration history records the negotiable property price migration, but price is NOT NULL.');
  }
  if (!applied && priceIsNullable) {
    throw new Error('Property price is already nullable without a migration record; inspect it manually.');
  }

  return {
    target: {
      database: target.database_name,
      server_version_num: target.server_version_num,
    },
    historyExists,
    applied: Boolean(applied),
  };
}

export async function runPropertyPriceNegotiableMigration(client, {
  migrationName,
  sql,
  checksum,
  apply = false,
}) {
  if (apply) {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(68127215, 3)');
      const current = await inspectPropertyPriceTarget(
        client,
        migrationName,
        checksum,
        { requireWritable: true },
      );
      if (current.applied) {
        await client.query('COMMIT');
        return { ...current, status: 'already_applied' };
      }
      if (!current.historyExists) {
        await client.query(
          `CREATE TABLE public.backend_schema_migrations (
             migration_name text PRIMARY KEY,
             checksum text NOT NULL,
             applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
           )`,
        );
      }
      await client.query(sql);
      await client.query(
        `INSERT INTO public.backend_schema_migrations (migration_name, checksum)
         VALUES ($1, $2)`,
        [migrationName, checksum],
      );
      await client.query('COMMIT');
      return { ...current, historyExists: true, status: 'applied' };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  const current = await inspectPropertyPriceTarget(
    client,
    migrationName,
    checksum,
    { requireWritable: false },
  );
  return {
    ...current,
    status: current.applied ? 'already_applied' : 'pending',
  };
}
