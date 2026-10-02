import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Central error-handling middleware.
 * Must be registered LAST with app.use(errorHandler).
 */
export function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code   = err.code || 'INTERNAL_ERROR';

  // Always log internally
  logger.error({ err, status, code }, 'Unhandled error');

  // Never leak stack traces in production
  const message =
    env.NODE_ENV === 'production' && status === 500
      ? 'An internal error occurred'
      : err.message || 'An internal error occurred';

  res.status(status).json({
    success: false,
    error: { code, message },
  });
}

/**
 * 404 catch-all for routes that don't exist.
 */
export function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
}
