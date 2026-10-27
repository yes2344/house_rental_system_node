import '../config/env.js';
import { ApiError } from '../errors.js';

const configuredOrigins = process.env.FRONTEND_ORIGINS
  || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173';
const allowedOrigins = new Set([
  ...configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
  'https://infinityhouseproperties.com',
]);

export function cors(request, response, next) {
  const origin = request.get('origin');
  response.set('Vary', 'Origin');

  if (origin) {
    if (!allowedOrigins.has(origin)) {
      next(new ApiError(403, 'Origin is not allowed.'));
      return;
    }
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Access-Control-Allow-Credentials', 'true');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRFToken');
    response.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  }

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  next();
}
