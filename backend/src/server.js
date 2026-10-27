import { createApp } from './app.js';
import { createPool } from './db.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const pool = createPool();
const app = createApp({ pool });
const server = app.listen(port, '0.0.0.0', () => {
  console.info(`Node API listening on port ${port}.`);
});

async function shutdown(signal) {
  console.info(`Received ${signal}; shutting down Node API.`);
  server.close(async (error) => {
    if (error) {
      console.error('Failed to close the HTTP server:', error);
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (poolError) {
      console.error('Failed to close the PostgreSQL connection pool:', poolError);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
