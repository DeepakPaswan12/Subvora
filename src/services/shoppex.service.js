import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// ════════════════════════════════════════════════════════
//  Shoppex Dynamic Product Delivery Service
//
//  Authoritative documentation:
//  https://docs.shoppex.io/developers/dynamic-delivery.md
//
//  DYNAMIC products use `dynamic_webhook` as a direct server-to-server
//  fulfillment callback after a paid invoice.
// ════════════════════════════════════════════════════════

/**
 * Verify incoming Shoppex Dynamic Delivery signature.
 *
 * Official spec from Shoppex docs:
 *   - Header: X-Shoppex-Signature-V2
 *   - Format: "v1,t=<timestamp>,h=<64_hex_sha256>"
 *   - Canonical string: "${deliveryId}.${timestamp}.${rawBody}"
 *   - Signed with: product's dynamic_webhook_secret (or fallback SHOPPEX_WEBHOOK_SECRET)
 *   - Replay protection: ±300 seconds (5 minutes)
 *
 * @param {object|string|Buffer} rawBodyOrParams
 * @param {object} [headersArg]
 * @param {string} [secretArg]
 * @returns {{ valid: boolean, code?: string, message?: string }}
 */
export function verifyShoppexSignature(rawBodyOrParams, headersArg = {}, secretArg = null) {
  let rawBody;
  let headers;
  let secret;

  if (
    rawBodyOrParams
    && typeof rawBodyOrParams === 'object'
    && !Buffer.isBuffer(rawBodyOrParams)
    && ('rawBody' in rawBodyOrParams || 'headers' in rawBodyOrParams)
  ) {
    rawBody = rawBodyOrParams.rawBody;
    headers = rawBodyOrParams.headers || {};
    secret = rawBodyOrParams.secret || env.SHOPPEX_DYNAMIC_WEBHOOK_SECRET || env.SHOPPEX_WEBHOOK_SECRET;
  } else {
    rawBody = rawBodyOrParams;
    headers = headersArg || {};
    secret = secretArg || env.SHOPPEX_DYNAMIC_WEBHOOK_SECRET || env.SHOPPEX_WEBHOOK_SECRET;
  }
  if (!secret) {
    logger.warn('Shoppex dynamic webhook secret is not configured in environment');
    return { valid: false, code: 'SECRET_NOT_CONFIGURED', message: 'Secret not configured' };
  }

  // Normalize header names (Express headers are lowercase)
  const signatureHeader = headers['x-shoppex-signature-v2'] || headers['x-shoppex-signature'];
  const deliveryId = headers['x-shoppex-delivery-id'] || headers['x-shoppex-idempotency-key'] || headers['x-shoppex-delivery'];
  const timestampHeader = headers['x-shoppex-timestamp'];

  if (!signatureHeader || !deliveryId || !timestampHeader) {
    logger.warn('Shoppex request missing required headers for signature verification');
    return { valid: false, code: 'MISSING_HEADERS', message: 'Missing required signature headers' };
  }

  const rawBodyStr = typeof rawBody === 'string' ? rawBody : (rawBody ? rawBody.toString('utf-8') : '');

  const segments = signatureHeader.split(',').map((part) => part.trim());
  const parts = Object.fromEntries(
    segments
      .filter((part) => part.includes('='))
      .map((part) => {
        const [key, ...rest] = part.trim().split('=');
        return [key, rest.join('=')];
      }),
  );

  // Must include 'v1' scheme and matching timestamp
  if (!segments.includes('v1') || parts.t !== String(timestampHeader)) {
    logger.warn('Shoppex signature header structure invalid or timestamp mismatch');
    return { valid: false, code: 'INVALID_SIGNATURE_HEADER', message: 'Invalid signature header structure' };
  }

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, code: 'INVALID_TIMESTAMP', message: 'Non-numeric timestamp' };
  }

  // Replay guard: 5 minutes (300 seconds)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    logger.warn({ timestamp, now }, 'Shoppex request timestamp outside 5-minute window');
    return { valid: false, code: 'TIMESTAMP_OUT_OF_TOLERANCE', message: 'Webhook timestamp expired or in the future' };
  }

  // Hash must be 64-char hex string
  if (!/^[0-9a-f]{64}$/i.test(parts.h ?? '')) {
    return { valid: false, code: 'INVALID_HASH_FORMAT', message: 'Invalid hash format' };
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${deliveryId}.${timestamp}.${rawBodyStr}`)
    .digest('hex');

  let matches = false;
  try {
    matches = crypto.timingSafeEqual(
      Buffer.from(parts.h, 'hex'),
      Buffer.from(expectedSignature, 'hex'),
    );
  } catch {
    matches = false;
  }

  if (!matches) {
    logger.warn('Shoppex webhook signature verification failed (digest mismatch)');
    return { valid: false, code: 'SIGNATURE_MISMATCH', message: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * Parse and validate the incoming Shoppex dynamic delivery payload.
 *
 * Official spec: Shoppex sends both camelCase and snake_case representations
 * for seamless interop.
 *
 * @param {object} body
 * @param {object} [headers={}]
 * @returns {object} normalized payload
 */
export function parseShoppexPayload(body = {}, headers = {}) {
  if (!body || typeof body !== 'object') {
    throw new Error('Malformed or empty JSON body');
  }

  const deliveryId = String(
    headers['x-shoppex-delivery-id']
      ?? headers['x-shoppex-idempotency-key']
      ?? body.deliveryId
      ?? body.delivery_id
      ?? body.idempotencyKey
      ?? body.idempotency_key
      ?? body.invoiceId
      ?? body.invoice_id
      ?? '',
  ).trim();

  const idempotencyKey = String(
    headers['x-shoppex-idempotency-key']
      ?? headers['x-shoppex-delivery-id']
      ?? body.idempotencyKey
      ?? body.idempotency_key
      ?? deliveryId,
  ).trim();

  const invoiceId = String(
    body.invoiceId
      ?? body.invoice_id
      ?? body.invoice?.uniqid
      ?? body.invoice?.id
      ?? idempotencyKey,
  ).trim();

  const productId = String(
    body.productId
      ?? body.product_id
      ?? body.product?.uniqid
      ?? body.product?.id
      ?? body.line_item?.product_id
      ?? '',
  ).trim();

  const productTitle = String(
    body.productTitle
      ?? body.product_title
      ?? body.product?.title
      ?? body.line_item?.product_title
      ?? '',
  ).trim();

  const customerEmail = body.customerEmail
    ?? body.customer_email
    ?? body.invoice?.customer_email
    ?? body.email
    ?? null;

  const quantity = Number(body.quantity ?? body.line_item?.quantity ?? 1) || 1;

  if (!productId && !productTitle) {
    throw new Error('Missing product identifier or title in Shoppex payload');
  }

  const orderId = String(
    body.orderId
      ?? body.order_id
      ?? invoiceId
      ?? deliveryId
      ?? '',
  ).trim();

  return {
    deliveryId: deliveryId || `del_${Date.now()}`,
    idempotencyKey: idempotencyKey || deliveryId || `idemp_${Date.now()}`,
    orderId,
    invoiceId,
    productId,
    productTitle,
    customerEmail,
    quantity,
    customFields: body.customFields ?? body.custom_fields ?? body.line_item?.custom_fields ?? {},
  };
}

/**
 * Format the official success response expected by Shoppex.
 *
 * Official spec:
 * Shoppex stores the nested `data` object, presenting `service_text` to the buyer
 * and storing `dynamic_response` as the delivered asset (tokens, license codes).
 */
export function formatShoppexSuccessResponse({ entitlementValue, orderId, serviceText }) {
  return {
    data: {
      service_text: serviceText || entitlementValue,
      dynamic_response: {
        key: entitlementValue,
        entitlement: entitlementValue,
      },
      deliveryType: 'DYNAMIC',
      count: 1,
    },
    // Top-level fields for backwards/universal compatibility
    status: 'success',
    content: entitlementValue,
    order_id: orderId,
  };
}

/**
 * Alias for formatShoppexSuccessResponse
 */
export const formatShoppexResponse = formatShoppexSuccessResponse;

/**
 * Format an out-of-stock / pending response.
 *
 * Official spec: If fulfillment cannot be completed immediately, respond with 200
 * and { "status": "pending" }. Shoppex marks the item as AWAITING_FULFILLMENT.
 */
export function formatShoppexPendingResponse(reason = 'Out of stock — awaiting replenishment') {
  return {
    status: 'pending',
    data: {
      status: 'pending',
      message: reason,
    },
  };
}

/**
 * Format an error response.
 */
export function formatShoppexErrorResponse(message) {
  return {
    status: 'error',
    error: message,
    message,
  };
}
