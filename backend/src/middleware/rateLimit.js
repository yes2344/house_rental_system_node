import { ApiError } from '../errors.js';

export function rateLimit({ limit, windowMs, key = (request) => request.ip }) {
  const requests = new Map();

  return (request, _response, next) => {
    const now = Date.now();
    const identifier = key(request);
    const recent = (requests.get(identifier) || []).filter((timestamp) => now - timestamp < windowMs);

    if (recent.length >= limit) {
      next(new ApiError(429, 'Request limit reached. Please try again later.'));
      return;
    }

    recent.push(now);
    requests.set(identifier, recent);
    if (requests.size > 10_000) {
      for (const [storedKey, timestamps] of requests) {
        if (!timestamps.some((timestamp) => now - timestamp < windowMs)) requests.delete(storedKey);
      }
    }
    next();
  };
}
