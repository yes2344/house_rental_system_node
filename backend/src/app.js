import { randomUUID } from 'node:crypto';
import express from 'express';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { apiRouter } from './routes/index.js';
import { getMediaConfig } from './config/media.js';
import { createEmailSender } from './services/emailService.js';

export function createApp({
  pool,
  logger = console,
  mediaConfig = getMediaConfig(),
  sendEmail,
}) {
  const app = express();
  const emailSender = sendEmail ?? createEmailSender({ logger });

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    request.requestId = randomUUID();
    request.requestStartedAt = process.hrtime.bigint();
    response.set('X-Request-ID', request.requestId);
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(cors);
  app.use('/media', (request, _response, next) => {
    if (!/\.(?:jpe?g|png|webp)$/i.test(request.path)) {
      next(Object.assign(new Error('Not found.'), { status: 404 }));
      return;
    }
    next();
  });
  app.use('/media', express.static(mediaConfig.publicRoot, {
    dotfiles: 'deny',
    fallthrough: false,
    index: false,
    maxAge: '1h',
    setHeaders(response) {
      response.set('X-Content-Type-Options', 'nosniff');
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1', apiRouter({ pool, logger, mediaConfig, sendEmail: emailSender }));
  app.use(notFound);
  app.use(errorHandler({ logger }));

  return app;
}
