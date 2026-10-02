import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logger — never attach secrets or entitlement values.
 * In development pretty-print; in production use JSON for log aggregators.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  // Redact known sensitive paths if they ever creep into log objects
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["webhook-signature"]',
      'apiKey',
      'secret',
      'password',
      'entitlement_value',
    ],
    censor: '[REDACTED]',
  },
});
