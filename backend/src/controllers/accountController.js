import {
  accountActivity,
  acceptDelegatedInvitation,
  confirmPasswordReset,
  getAuthenticatedAccount,
  getPreferences,
  login,
  register,
  requestAccountEmail,
  revokeSession,
  updateAccount,
  updateAgentOnboardingPassword,
  updateAgentOnboardingProfile,
  updatePreferences,
  verifyAccountEmail,
} from '../services/accountService.js';
import { createCsrfToken, csrfTokenController } from '../middleware/csrf.js';

export function accountController({ pool }) {
  return {
    csrf: csrfTokenController,
    register: async (request, response) => {
      const account = await register(pool, request.validated.body);
      response.status(201).json(account);
    },
    login: async (request, response) => {
      const credentials = request.validated.body;
      const result = await login(
        pool,
        credentials.identifier || credentials.username,
        credentials.password,
      );
      const csrfToken = createCsrfToken(response);
      response.status(200).json({
        ...result.account,
        csrf_token: csrfToken,
        session_token: result.sessionToken,
      });
    },
    logout: async (request, response) => {
      await revokeSession(pool, request.auth.session_id);
      response.status(204).end();
    },
    me: async (request, response) => {
      if (request.method === 'GET') {
        response.json(await getAuthenticatedAccount(pool, request.userId));
        return;
      }
      response.json(await updateAccount(pool, request.userId, request.validated.body));
    },
    preferences: async (request, response) => {
      if (request.method === 'GET') {
        response.json(await getPreferences(pool, request.userId));
        return;
      }
      response.json(await updatePreferences(pool, request.userId, request.validated.body));
    },
    resetPreferences: async (request, response) => {
      response.json(await updatePreferences(pool, request.userId, {}, true));
    },
    activity: async (request, response) => {
      response.json(await accountActivity(pool, request.userId));
    },
  };
}

export function accountExtensionsController({ pool, sendEmail }) {
  if (typeof sendEmail !== 'function') {
    throw new Error('Configure sendEmail({ to, purpose, uid, token }) before mounting account extensions.');
  }

  return {
    resendVerification: async (request, response) => {
      await requestAccountEmail(pool, request.validated.body.email, 'verification', sendEmail);
      response.status(202).json({
        detail: 'If an unverified account matches that email, a verification message will be sent.',
      });
    },
    requestPasswordReset: async (request, response) => {
      await requestAccountEmail(pool, request.validated.body.email, 'password_reset', sendEmail);
      response.status(202).json({
        detail: 'If an account matches that email, password reset instructions will be sent.',
      });
    },
    verifyEmail: async (request, response) => {
      response.json(await verifyAccountEmail(
        pool,
        request.validated.body.uid,
        request.validated.body.token,
      ));
    },
    confirmPasswordReset: async (request, response) => {
      const { uid, token, password } = request.validated.body;
      response.json(await confirmPasswordReset(pool, uid, token, password));
    },
    acceptInvitation: async (request, response) => {
      const { token, password } = request.validated.body;
      response.json(await acceptDelegatedInvitation(pool, token, password));
    },
    agentOnboardingPassword: async (request, response) => {
      response.json(await updateAgentOnboardingPassword(
        pool,
        request.userId,
        request.auth.session_id,
        request.validated.body,
      ));
    },
    agentOnboardingProfile: async (request, response) => {
      response.json(await updateAgentOnboardingProfile(
        pool,
        request.userId,
        request.validated.body,
      ));
    },
  };
}
