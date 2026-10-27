import { Router } from 'express';
import { accountExtensionsController } from '../controllers/accountController.js';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  agentOnboardingPasswordSchema,
  agentOnboardingProfileSchema,
  emailAddressSchema,
  emailVerificationSchema,
  invitationAcceptSchema,
  passwordResetConfirmSchema,
} from '../validators/accounts.js';

function emailRateLimits() {
  return [
    rateLimit({ limit: 3, windowMs: 60 * 60 * 1000 }),
    rateLimit({
      limit: 3,
      windowMs: 60 * 60 * 1000,
      key: (request) => String(request.validated.body.email).toLowerCase(),
    }),
  ];
}

/**
 * `sendEmail` must reject when delivery is not accepted by the configured provider.
 * Unknown addresses are passed with null `uid` and `token` to preserve enumeration safety.
 */
export function accountExtensionsRouter({ pool, sendEmail }) {
  const router = Router();
  const accounts = accountExtensionsController({ pool, sendEmail });
  const emailIpLimit = rateLimit({ limit: 10, windowMs: 60 * 60 * 1000 });
  const tokenIpLimit = rateLimit({ limit: 10, windowMs: 60 * 60 * 1000 });
  const invitationIpLimit = rateLimit({ limit: 10, windowMs: 60 * 60 * 1000 });
  const onboardingIpLimit = rateLimit({ limit: 20, windowMs: 60 * 60 * 1000 });

  for (const [path, purpose] of [
    ['/auth/verify-email/resend/', 'verification'],
    ['/auth/password-reset/', 'password_reset'],
  ]) {
    const emailLimits = emailRateLimits();
    router.post(
      path,
      emailIpLimit,
      validateRequest(emailAddressSchema),
      ...emailLimits,
      purpose === 'verification' ? accounts.resendVerification : accounts.requestPasswordReset,
    );
  }

  router.post(
    '/auth/verify-email/',
    tokenIpLimit,
    validateRequest(emailVerificationSchema),
    accounts.verifyEmail,
  );
  router.post(
    '/auth/password-reset/confirm/',
    tokenIpLimit,
    validateRequest(passwordResetConfirmSchema),
    accounts.confirmPasswordReset,
  );
  router.post(
    '/auth/invitations/accept/',
    invitationIpLimit,
    validateRequest(invitationAcceptSchema),
    accounts.acceptInvitation,
  );
  router.post(
    '/auth/agent-onboarding/password/',
    onboardingIpLimit,
    authenticate({ pool }),
    rateLimit({
      limit: 10,
      windowMs: 60 * 60 * 1000,
      key: (request) => String(request.userId),
    }),
    validateRequest(agentOnboardingPasswordSchema),
    accounts.agentOnboardingPassword,
  );
  router.post(
    '/auth/agent-onboarding/profile/',
    onboardingIpLimit,
    authenticate({ pool }),
    rateLimit({
      limit: 10,
      windowMs: 60 * 60 * 1000,
      key: (request) => String(request.userId),
    }),
    validateRequest(agentOnboardingProfileSchema),
    accounts.agentOnboardingProfile,
  );

  return router;
}
