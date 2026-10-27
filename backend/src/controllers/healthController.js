import { checkDatabase } from '../services/healthService.js';

export function healthController({ pool, logger }) {
  return async (_request, response) => {
    try {
      await checkDatabase(pool);
      response.status(200).json({ status: 'ok', database: 'ok' });
    } catch (error) {
      logger.error('PostgreSQL health check failed:', error.code || error.name);
      response.status(503).json({
        error: {
          status_code: 503,
          message: 'The service is temporarily unavailable.',
          details: {},
        },
      });
    }
  };
}
