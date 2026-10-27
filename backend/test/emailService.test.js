import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmailSender, getSmtpConfiguration } from '../src/services/emailService.js';

function productionEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'private-test-password',
    EMAIL_FROM: 'Infinity House <noreply@example.test>',
    FRONTEND_URL: 'https://homes.example.test',
    ...overrides,
  };
}

test('SMTP configuration validates credentials, sender, and secure frontend origin', () => {
  assert.deepEqual(getSmtpConfiguration(productionEnvironment()).errors, []);
  assert.equal(
    getSmtpConfiguration(productionEnvironment({ FRONTEND_URL: 'http://homes.example.test' }))
      .errors.includes('FRONTEND_URL must use HTTPS in production'),
    true,
  );
  assert.equal(
    getSmtpConfiguration(productionEnvironment({ SMTP_PASS: '' })).errors.includes('SMTP_PASS'),
    true,
  );
  assert.equal(
    getSmtpConfiguration(productionEnvironment({ FRONTEND_URL: 'https://homes.example.test/app?next=/' }))
      .errors.includes('FRONTEND_URL must be an origin without credentials, path, query, or fragment'),
    true,
  );
});

test('SMTP sender sends one-time links over a TLS-required transport', async () => {
  let transportOptions;
  let sentMessage;
  const sendEmail = createEmailSender({
    environment: productionEnvironment(),
    logger: { error() { assert.fail('successful delivery must not log an error'); } },
    createTransport(options) {
      transportOptions = options;
      return { async sendMail(message) { sentMessage = message; } };
    },
  });

  await sendEmail({
    to: 'customer@example.test',
    purpose: 'verification',
    uid: '15',
    token: 'one-time-token',
  });

  assert.equal(transportOptions.requireTLS, true);
  assert.equal(transportOptions.auth.pass, 'private-test-password');
  assert.equal(sentMessage.to, 'customer@example.test');
  assert.equal(sentMessage.from, 'Infinity House <noreply@example.test>');
  assert.match(sentMessage.text, /https:\/\/homes\.example\.test\/verify-email\?uid=15&token=one-time-token/);
  assert.equal(sentMessage.html, undefined);
});

test('SMTP sender does not include a token for an unknown account', async () => {
  let sentMessage;
  const sendEmail = createEmailSender({
    environment: productionEnvironment(),
    logger: console,
    createTransport: () => ({ async sendMail(message) { sentMessage = message; } }),
  });

  await sendEmail({
    to: 'unknown@example.test',
    purpose: 'password_reset',
    uid: null,
    token: null,
  });

  assert.equal(sentMessage.text.includes('uid='), false);
  assert.equal(sentMessage.text.includes('token='), false);
});

test('SMTP sender rejects missing configuration and surfaces provider failures', async () => {
  const errors = [];
  const unavailable = createEmailSender({
    environment: productionEnvironment({ SMTP_HOST: '' }),
    logger: { error(...values) { errors.push(values); } },
  });
  await assert.rejects(unavailable({ to: 'customer@example.test', purpose: 'verification', uid: null, token: null }));
  assert.equal(errors.length, 1);

  const providerFailure = new Error('SMTP unavailable');
  const failingSender = createEmailSender({
    environment: productionEnvironment(),
    logger: { error(...values) { errors.push(values); } },
    createTransport: () => ({ async sendMail() { throw providerFailure; } }),
  });
  await assert.rejects(
    failingSender({ to: 'customer@example.test', purpose: 'verification', uid: null, token: null }),
    (error) => error === providerFailure,
  );
  assert.equal(errors.length, 2);
});
