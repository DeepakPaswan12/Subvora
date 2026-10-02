import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ════════════════════════════════════════════════════════
//  Whop API Configuration — single source of truth
// ════════════════════════════════════════════════════════

/**
 * Official Whop API base URL.
 * Ref: https://dev.whop.com/reference/webhooks
 */
const WHOP_API_BASE = 'https://api.whop.com/api/v1';

/**
 * Optional API version date header.
 * See: https://dev.whop.com/developer/api/versioning
 * Set to a known stable version date to pin behavior.
 * Update when you are ready to migrate to a newer schema.
 */
const WHOP_API_VERSION_DATE = '2025-01-01';

// ════════════════════════════════════════════════════════
//  Supported webhook events — update in one place
// ════════════════════════════════════════════════════════

/**
 * Map of Whop webhook event types this backend handles.
 * Source: https://dev.whop.com/ → Webhooks section
 *
 * Add new events here as the integration grows.
 */
export const SUPPORTED_EVENTS = Object.freeze({
  // Payment lifecycle
  'payment.succeeded':  'handlePaymentSucceeded',
  'payment.failed':     'handlePaymentFailed',

  // Membership lifecycle
  'membership.activated':   'handleMembershipActivated',
  'membership.deactivated': 'handleMembershipDeactivated',
});

// ════════════════════════════════════════════════════════
//  Webhook signature verification
// ════════════════════════════════════════════════════════

/**
 * Verify an incoming Whop webhook using the Standard Webhooks spec.
 *
 * Whop sends three headers with every webhook delivery:
 *   - webhook-id        — unique event ID
 *   - webhook-timestamp — UNIX seconds when the message was sent
 *   - webhook-signature — "v1,<base64(HMAC-SHA256)>"
 *
 * The signing input is: "${webhook-id}.${webhook-timestamp}.${rawBody}"
 * The key is the base64-decoded portion of the secret after the "whsec_" prefix.
 *
 * @param {string|Buffer} rawBody    — the raw, unparsed request body
 * @param {object}        headers    — the full request headers
 * @returns {{ id: string, timestamp: number, payload: object }}
 * @throws  if verification fails
 */
export function verifyWebhook(rawBody, headers) {
  const msgId    = headers['webhook-id'];
  const msgTs    = headers['webhook-timestamp'];
  const msgSig   = headers['webhook-signature'];

  if (!msgId || !msgTs || !msgSig) {
    const err = new Error('Missing required webhook headers');
    err.status = 401;
    err.code = 'WEBHOOK_HEADERS_MISSING';
    throw err;
  }

  // ── Replay-attack guard: reject events older than 5 minutes ──
  const MAX_AGE_SECONDS = 300;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(msgTs)) > MAX_AGE_SECONDS) {
    const err = new Error('Webhook timestamp too old or too far in the future');
    err.status = 401;
    err.code = 'WEBHOOK_TIMESTAMP_INVALID';
    throw err;
  }

  // ── Derive signing key ──
  const secret = env.WHOP_WEBHOOK_SECRET;
  // Standard Webhooks secrets start with "whsec_"; the actual key is the rest, base64-encoded
  const secretBytes = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64',
  );

  // ── Compute expected signature ──
  const signedContent = `${msgId}.${msgTs}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // ── Compare against all provided v1 signatures ──
  const signatures = msgSig.split(' ');
  const verified = signatures.some((sig) => {
    const [version, value] = sig.split(',');
    if (version !== 'v1' || !value) return false;
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(value),
    );
  });

  if (!verified) {
    const err = new Error('Invalid webhook signature');
    err.status = 401;
    err.code = 'WEBHOOK_SIGNATURE_INVALID';
    throw err;
  }

  const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString());

  return { id: msgId, timestamp: Number(msgTs), payload };
}

// ════════════════════════════════════════════════════════
//  Whop API helpers
// ════════════════════════════════════════════════════════

/**
 * Internal fetch wrapper for the Whop API.
 * @param {string} path — path relative to WHOP_API_BASE (e.g. "/products/prod_xxx")
 * @returns {Promise<object>}
 */
async function whopFetch(path) {
  const url = `${WHOP_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.WHOP_API_KEY}`,
      'Api-Version-Date': WHOP_API_VERSION_DATE,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, url, body }, 'Whop API request failed');
    const err = new Error(`Whop API error: ${res.status}`);
    err.status = res.status;
    err.code = 'WHOP_API_ERROR';
    throw err;
  }

  return res.json();
}

/**
 * Retrieve a Whop product by ID.
 * Endpoint: GET /products/:id
 */
export async function getProduct(productId) {
  return whopFetch(`/products/${productId}`);
}

/**
 * Retrieve a Whop plan by ID.
 * Endpoint: GET /plans/:id
 */
export async function getPlan(planId) {
  return whopFetch(`/plans/${planId}`);
}

/**
 * Retrieve a Whop membership by ID.
 * Endpoint: GET /memberships/:id
 */
export async function getMembership(membershipId) {
  return whopFetch(`/memberships/${membershipId}`);
}

/**
 * Retrieve the current authenticated account.
 * Endpoint: GET /accounts/me
 */
export async function getAccount() {
  return whopFetch('/accounts/me');
}

/**
 * Retrieve a payment by ID.
 * Endpoint: GET /payments/:id
 *
 * TODO: Verify this endpoint exists in the current Whop API version.
 *       If not available, payment details should be extracted from the
 *       webhook payload directly.
 */
export async function getPayment(paymentId) {
  return whopFetch(`/payments/${paymentId}`);
}
