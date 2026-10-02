import { env } from '../config/env.js';

/**
 * Placeholder auth middleware for future admin endpoints.
 *
 * TODO: Implement proper authentication before enabling any admin routes.
 * Options to consider:
 *   - Supabase Auth JWT verification
 *   - API key with scoped permissions stored in an admin_keys table
 *   - OAuth 2.0 / OIDC integration
 *
 * NEVER allow unauthenticated access to inventory management,
 * order mutation, or any write endpoint.
 */
export function requireAuth(req, res, next) {
  // ── Guard: reject all requests until auth is implemented ──
  return res.status(501).json({
    success: false,
    error: {
      code: 'AUTH_NOT_IMPLEMENTED',
      message: 'Admin authentication has not been configured yet.',
    },
  });
}

/**
 * Lightweight check that the request originates from the configured
 * CORS origin. This is NOT a substitute for real auth.
 */
export function requireOrigin(req, res, next) {
  const origin = req.get('origin') || req.get('referer') || '';
  if (env.NODE_ENV === 'production' && !origin.startsWith(env.CORS_ORIGIN)) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Origin not allowed' },
    });
  }
  next();
}
