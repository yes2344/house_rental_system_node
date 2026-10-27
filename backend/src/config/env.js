import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

function requiredValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured in the backend environment.`);
  }
  return value;
}

function optionalPort() {
  const value = process.env.PGPORT?.trim();
  if (!value) return 5432;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PGPORT must be an integer between 1 and 65535.');
  }
  return port;
}

function sslConfig() {
  if (process.env.PGSSL !== 'true') return false;
  return { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' };
}

export function getDatabaseConfig({ migration = false } = {}) {
  const configuredUrl = migration
    ? process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
    : process.env.DATABASE_URL?.trim();
  if (configuredUrl) {
    const config = { connectionString: configuredUrl };
    if (process.env.PGSSL === 'true') config.ssl = sslConfig();
    return config;
  }

  return {
    host: requiredValue('PGHOST'),
    port: optionalPort(),
    database: requiredValue('PGDATABASE'),
    user: requiredValue('PGUSER'),
    password: requiredValue('PGPASSWORD'),
    ssl: sslConfig(),
  };
}

export const databaseSchema = process.env.PGSCHEMA?.trim() || 'public';
