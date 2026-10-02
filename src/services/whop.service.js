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

// Log whether the webhook secret is configured (never log the value)
logger.info(
  { configured: Boolean(env.WHOP_WEBHOOK_SECRET) },
  'WHOP_WEBHOOK_SECRET environment variable status',
);

/**
 * Verify an incoming Whop webhook using the Standard Webhooks spec.
 *
 * Official documentation: https://docs.whop.com/developer/guides/webhooks
 *
 * Whop sends three headers with every webhook delivery:
 *   - webhook-id        — unique event ID (e.g. "msg_bQPHmO2eBnHYtWWuxAN9K3Xd")
 *   - webhook-timestamp — UNIX seconds when the message was sent
 *   - webhook-signature — "v1,<base64(HMAC-SHA256)>"
 *
 * Signed content: "${webhook-id}.${webhook-timestamp}.${rawBody}"
 *
 * IMPORTANT — Key format (from official Whop docs):
 *   The secret is a `ws_` prefixed hex string (e.g. ws_0123456789abcdef...).
 *   The HMAC key is the raw secret string itself. Do NOT strip the prefix.
 *   Do NOT base64-decode it. Pass it to HMAC exactly as Whop gave it.
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

  // ── Derive signing key ──────────────────────────────────────
  // From Whop docs: "pass it to the helper exactly as Whop gave
  // it to you — a ws_ string. Don't strip the prefix, and don't
  // base64-encode it. The helper derives the key."
  //
  // The raw secret string IS the HMAC key.
  const secret = env.WHOP_WEBHOOK_SECRET;
  const secretKey = Buffer.from(secret, 'utf-8');

  // ── Compute expected signature ──
  const rawBodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
  const signedContent = `${msgId}.${msgTs}.${rawBodyStr}`;
  const expectedSig = crypto
    .createHmac('sha256', secretKey)
    .update(signedContent)
    .digest('base64');

  // ── Compare against all provided v1 signatures ──
  // The webhook-signature header may contain multiple space-separated
  // signatures (e.g. during key rotation). Match any one.
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  const signatures = msgSig.split(' ');
  const verified = signatures.some((sig) => {
    const commaIdx = sig.indexOf(',');
    if (commaIdx === -1) return false;
    const version = sig.slice(0, commaIdx);
    const value   = sig.slice(commaIdx + 1);
    if (version !== 'v1' || !value) return false;

    // timingSafeEqual throws if buffer lengths differ — guard against it
    const valueBuf = Buffer.from(value, 'utf-8');
    if (expectedBuf.length !== valueBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, valueBuf);
  });

  if (!verified) {
    const err = new Error('Invalid webhook signature');
    err.status = 401;
    err.code = 'WEBHOOK_SIGNATURE_INVALID';
    throw err;
  }

  const payload = JSON.parse(rawBodyStr);

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
