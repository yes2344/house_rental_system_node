import { createHash } from 'node:crypto';
import { ApiError } from '../errors.js';

export function authenticate({ pool, required = true }) {
  return async (request, _response, next) => {
    try {
      const header = request.get('authorization');
      if (!header) {
        if (required) throw new ApiError(401, 'Authentication credentials were not provided.');
        return next();
      }

      const [scheme, token, ...extra] = header.trim().split(/\s+/);
      if (scheme?.toLowerCase() !== 'bearer' || !token || extra.length) {
        throw new ApiError(401, 'Invalid session authorization header.');
      }

      const digest = createHash('sha256').update(token, 'utf8').digest('hex');
      const result = await pool.query(
        `SELECT session.id AS session_id, session.user_id
         FROM accounts_tabsessiontoken AS session
         JOIN auth_user AS account ON account.id = session.user_id
         WHERE session.token_digest = $1
           AND session.revoked_at IS NULL
           AND session.expires_at > CURRENT_TIMESTAMP
           AND account.is_active = TRUE`,
        [digest],
      );
      if (result.rowCount !== 1) {
        throw new ApiError(401, 'Invalid or expired session token.');
      }

      request.auth = result.rows[0];
      request.userId = result.rows[0].user_id;
      next();
    } catch (error) {
      next(error);
    }
  };
}
