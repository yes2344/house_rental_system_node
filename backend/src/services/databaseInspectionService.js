import { withReadOnlyTransaction } from '../db.js';

export async function inspectDatabase(pool, schema) {
  return withReadOnlyTransaction(pool, async (client) => {
    const server = await client.query(`
      SELECT
        current_setting('server_version') AS server_version,
        current_database() AS database_name,
        current_schema() AS current_schema,
        current_user AS database_user,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port,
        current_setting('transaction_read_only') AS transaction_read_only
    `);
    const schemaResult = await client.query(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
      [schema],
    );
    const columns = await client.query(`
      SELECT
        table_name,
        column_name,
        ordinal_position,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        is_identity,
        identity_generation,
        is_generated,
        generation_expression
      FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position
    `, [schema]);
    const constraints = await client.query(`
      SELECT
        relation.relname AS table_name,
        constraint_row.conname AS constraint_name,
        CASE constraint_row.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUSION'
          WHEN 'n' THEN 'NOT NULL'
          ELSE constraint_row.contype::text
        END AS constraint_type,
        pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = $1
      ORDER BY relation.relname, constraint_row.conname
    `, [schema]);
    const indexes = await client.query(
      'SELECT tablename AS table_name, indexname AS index_name, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname',
      [schema],
    );
    const sequences = await client.query(
      `
        SELECT
          sequence_relation.relname AS sequence_name,
          sequence.seqtypid::regtype::text AS data_type,
          sequence.seqstart AS start_value,
          sequence.seqmin AS minimum_value,
          sequence.seqmax AS maximum_value,
          sequence.seqincrement AS increment,
          sequence.seqcache AS cache_size,
          sequence.seqcycle AS cycle
        FROM pg_class AS sequence_relation
        JOIN pg_namespace AS namespace ON namespace.oid = sequence_relation.relnamespace
        JOIN pg_sequence AS sequence ON sequence.seqrelid = sequence_relation.oid
        WHERE namespace.nspname = $1 AND sequence_relation.relkind = 'S'
        ORDER BY sequence_relation.relname
      `,
      [schema],
    );
    const grants = await client.query(
      'SELECT table_name, privilege_type, is_grantable FROM information_schema.role_table_grants WHERE table_schema = $1 AND grantee = current_user ORDER BY table_name, privilege_type',
      [schema],
    );

    return {
      server: server.rows[0],
      schemaExists: schemaResult.rowCount === 1,
      schema,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      sequences: sequences.rows,
      currentRoleGrants: grants.rows,
    };
  });
}
