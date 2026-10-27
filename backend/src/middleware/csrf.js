import '../config/env.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../errors.js';

const cookieName = 'csrftoken';
const trustedOrigins = new Set(
  (process.env.CSRF_TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function cookieValue(request, name) {
  const entry = (request.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return '';
  }
}

function setCsrfCookie(response, token) {
  const production = process.env.NODE_ENV === 'production';
  const flags = ['Path=/', `SameSite=${production ? 'None' : 'Lax'}`];
  if (production) flags.push('Secure');
  response.append('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; ${flags.join('; ')}`);
}

export function createCsrfToken(response) {
  const token = randomBytes(32).toString('hex');
  setCsrfCookie(response, token);
  return token;
}

export function csrfTokenController(_request, response) {
  response.json({ csrf_token: createCsrfToken(response) });
}

export function requireCsrf(request, _response, next) {
  const cookieToken = cookieValue(request, cookieName);
  const headerToken = request.get('x-csrftoken') || '';
  const origin = request.get('origin');
  const sameOrigin = origin
    ? (() => {
      try {
        return new URL(origin).host.toLowerCase() === request.get('host')?.toLowerCase();
      } catch {
        return false;
      }
    })()
    : true;
  const trustedOrigin = origin && trustedOrigins.has(origin);

  if (
    !cookieToken
    || !headerToken
    || !sameOrigin && !trustedOrigin
    || Buffer.byteLength(cookieToken) !== Buffer.byteLength(headerToken)
    || !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    next(new ApiError(403, 'CSRF verification failed. Request not allowed.'));
    return;
  }
  next();
}
