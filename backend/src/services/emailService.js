import nodemailer from 'nodemailer';

export function getSmtpConfiguration(environment = process.env) {
  const missing = [];
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'FRONTEND_URL']) {
    if (!environment[key]?.trim()) missing.push(key);
  }

  const rawPort = environment.SMTP_PORT?.trim() || '587';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    missing.push('SMTP_PORT must be an integer between 1 and 65535');
  }

  let secure = port === 465;
  if (environment.SMTP_SECURE !== undefined && environment.SMTP_SECURE.trim() !== '') {
    if (!['true', 'false'].includes(environment.SMTP_SECURE.trim())) {
      missing.push('SMTP_SECURE must be true or false');
    } else {
      secure = environment.SMTP_SECURE.trim() === 'true';
    }
  }

  let frontendUrl;
  try {
    frontendUrl = new URL(environment.FRONTEND_URL);
    if (!['http:', 'https:'].includes(frontendUrl.protocol)) {
      missing.push('FRONTEND_URL must use HTTP or HTTPS');
    } else if (environment.NODE_ENV === 'production' && frontendUrl.protocol !== 'https:') {
      missing.push('FRONTEND_URL must use HTTPS in production');
    }
    if (
      frontendUrl.username
      || frontendUrl.password
      || frontendUrl.pathname !== '/'
      || frontendUrl.search
      || frontendUrl.hash
    ) {
      missing.push('FRONTEND_URL must be an origin without credentials, path, query, or fragment');
    }
  } catch {
    missing.push('FRONTEND_URL must be a valid absolute URL');
  }

  return {
    errors: missing,
    configuration: missing.length > 0
      ? null
      : {
        host: environment.SMTP_HOST.trim(),
        port,
        secure,
        auth: {
          user: environment.SMTP_USER.trim(),
          pass: environment.SMTP_PASS,
        },
        from: environment.EMAIL_FROM.trim(),
        frontendUrl,
      },
  };
}

function messageContent(message, frontendUrl) {
  if (!['verification', 'password_reset'].includes(message.purpose)) {
    throw new Error('Unsupported account email purpose.');
  }
  if ((message.uid === null) !== (message.token === null)) {
    throw new Error('Account email token is incomplete.');
  }

  const isVerification = message.purpose === 'verification';
  const subject = isVerification ? 'Verify your Infinity House email' : 'Reset your Infinity House password';
  if (!message.uid || !message.token) {
    return {
      subject,
      text: isVerification
        ? 'If this address belongs to an unverified Infinity House account, follow the verification instructions requested from the site.'
        : 'If this address belongs to an Infinity House account, a password reset was requested. If you did not request it, you can ignore this message.',
    };
  }

  const link = new URL(isVerification ? '/verify-email' : '/reset-password', frontendUrl);
  link.searchParams.set('uid', message.uid);
  link.searchParams.set('token', message.token);
  return {
    subject,
    text: `${isVerification
      ? 'Confirm your email address using this link:'
      : 'Choose a new password using this link:'}\n\n${link}\n\nIf you did not request this message, you can ignore it.`,
  };
}

export function createEmailSender({
  environment = process.env,
  logger = console,
  createTransport = nodemailer.createTransport,
} = {}) {
  const { errors, configuration } = getSmtpConfiguration(environment);
  let transport;

  return async (message) => {
    if (!configuration) {
      const error = new Error(`SMTP email delivery is not configured: ${errors.join('; ')}`);
      logger.error('Email delivery is not configured.', { missing: errors });
      throw error;
    }
    if (!transport) {
      transport = createTransport({
        host: configuration.host,
        port: configuration.port,
        secure: configuration.secure,
        requireTLS: !configuration.secure,
        auth: configuration.auth,
      });
    }

    try {
      await transport.sendMail({
        from: configuration.from,
        to: message.to,
        ...messageContent(message, configuration.frontendUrl),
      });
    } catch (error) {
      logger.error('SMTP email delivery failed.', error.code || error.name);
      throw error;
    }
  };
}
