import { z } from 'zod';

const passwordSchema = z.string().min(8).max(256);

export const loginSchema = z.object({
  identifier: z.string().trim().max(254).optional(),
  username: z.string().trim().max(150).optional(),
  password: z.string().min(1).max(256),
}).refine((data) => Boolean(data.identifier || data.username), {
  path: ['username'],
  message: 'Enter your email address, phone, or username.',
});

export const registrationSchema = z.object({
  username: z.string().trim().min(1).max(150)
    .regex(/^[\p{L}\p{N}_@.+-]+$/u, 'Enter a valid username.'),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  phone: z.string().max(50).optional().default(''),
}).superRefine((data, context) => {
  const password = data.password.toLocaleLowerCase();
  if (
    data.username.length >= 3
    && password.includes(data.username.toLocaleLowerCase())
  ) {
    context.addIssue({
      code: 'custom',
      path: ['password'],
      message: 'The password is too similar to the username.',
    });
  }
  const emailLocalPart = data.email.split('@')[0];
  if (emailLocalPart.length >= 3 && password.includes(emailLocalPart.toLocaleLowerCase())) {
    context.addIssue({
      code: 'custom',
      path: ['password'],
      message: 'The password is too similar to the email address.',
    });
  }
  if (/^\d+$/.test(data.password)) {
    context.addIssue({
      code: 'custom',
      path: ['password'],
      message: 'The password cannot be entirely numeric.',
    });
  }
});

export const accountPatchSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  first_name: z.string().max(150).optional(),
  last_name: z.string().max(150).optional(),
  phone: z.string().max(50).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one account field is required.',
});

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  locale: z.enum(['en', 'am']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  reduced_motion: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one preference is required.',
});

export const emailAddressSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();

export const emailVerificationSchema = z.object({
  uid: z.string().min(1).max(64),
  token: z.string().min(20).max(256),
}).strict();

export const passwordResetConfirmSchema = z.object({
  uid: z.string().min(1).max(64),
  token: z.string().min(20).max(256),
  password: passwordSchema,
  password_confirmation: passwordSchema,
}).strict().refine((data) => data.password === data.password_confirmation, {
  path: ['password_confirmation'],
  message: 'Passwords do not match.',
});

export const invitationAcceptSchema = z.object({
  token: z.string().min(20).max(256),
  password: passwordSchema,
}).strict();

export const agentOnboardingPasswordSchema = z.object({
  username: z.string().trim().max(150)
    .refine((value) => !value || /^[\p{L}\p{N}_@.+-]+$/u.test(value), 'Enter a valid username.')
    .optional(),
  new_password: passwordSchema,
}).strict();

export const agentOnboardingProfileSchema = z.object({
  first_name: z.string().min(1).max(150),
  last_name: z.string().min(1).max(150),
  email: z.string().trim().email().max(254),
  phone: z.string().min(1).max(50),
}).strict();
