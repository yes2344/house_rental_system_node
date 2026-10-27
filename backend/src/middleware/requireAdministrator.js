import { ApiError } from '../errors.js';

export function requireAdministrator({ pool }) {
  return async (request, _response, next) => {
    try {
      const result = await pool.query(
        `SELECT account.is_staff, account.is_superuser, profile.role
         FROM auth_user AS account
         LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
         WHERE account.id = $1 AND account.is_active = TRUE`,
        [request.userId],
      );
      const account = result.rows[0];
      if (
        !account
        || !(account.is_superuser || (account.is_staff && account.role === 'administrator'))
      ) {
        throw new ApiError(403, 'Administrator access is required.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
