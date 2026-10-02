import { logger } from '../utils/logger.js';
import {
  verifyShoppexSignature,
  parseShoppexPayload,
  formatShoppexResponse,
  formatShoppexErrorResponse,
} from '../services/shoppex.service.js';
import { findEvent, recordEvent, markEventProcessed } from '../utils/idempotency.js';
import { createOrder } from '../services/order.service.js';
import { fulfillOrder, findSubvoraProductByShoppex } from '../services/fulfillment.service.js';
import { reserveInventory } from '../services/inventory.service.js';

const PROVIDER = 'shoppex';

/**
 * POST /webhooks/shoppex
 *
 * Shoppex Dynamic Product webhook.
 * Called after payment — must return the content the buyer receives.
 *
 * ⚠️  This handler is an ADAPTER with placeholder logic.
 *     See SHOPPEX_WEBHOOK.md and src/services/shoppex.service.js
 *     for the list of TODOs that must be resolved with official docs.
 */
export async function handleShoppexWebhook(req, res) {
  // ── 1. Verify signature ──────────────────────────────
  // TODO: Enable once real verification is implemented
  const signatureValid = verifyShoppexSignature(req.rawBody, req.headers);
  if (!signatureValid) {
    logger.warn('Shoppex webhook signature verification failed or not configured');
    // TODO: In production, return 401 once verification is implemented.
    //       For now, continue processing to allow integration testing.
    // return res.status(401).json(formatShoppexErrorResponse('Invalid signature'));
  }

  // ── 2. Parse payload ──────────────────────────────────
  let parsed;
  try {
    parsed = parseShoppexPayload(req.body);
  } catch (err) {
    logger.warn({ err }, 'Shoppex payload parsing failed');
    return res.status(400).json(formatShoppexErrorResponse('Invalid payload'));
  }

  const { orderId: externalOrderId, productId: shoppexProductId, customerEmail } = parsed;

  // TODO: Extract a stable event ID from the Shoppex payload for idempotency.
  //       Using externalOrderId as a fallback.
  const eventId = externalOrderId || `shoppex_${Date.now()}`;

  logger.info({ eventId, shoppexProductId }, 'Shoppex webhook received');

  // ── 3. Idempotency ────────────────────────────────────
  const existing = await findEvent(PROVIDER, eventId);
  if (existing?.processed) {
    logger.info({ eventId }, 'Shoppex webhook already processed');
    // TODO: Return the previously generated content if Shoppex expects it.
    return res.status(200).json(formatShoppexResponse({
      entitlementValue: '(already delivered)',
      orderId: eventId,
    }));
  }

  const recorded = existing
    ? { id: existing.id }
    : await recordEvent(PROVIDER, eventId, 'dynamic_product', req.body);

  if (!recorded) {
    return res.status(200).json(formatShoppexResponse({
      entitlementValue: '(already delivered)',
      orderId: eventId,
    }));
  }

  // ── 4. Find product ───────────────────────────────────
  if (!shoppexProductId) {
    logger.error('Shoppex payload missing product identifier');
    return res.status(400).json(formatShoppexErrorResponse('Missing product identifier'));
  }

  const product = await findSubvoraProductByShoppex(shoppexProductId);
  if (!product) {
    logger.error({ shoppexProductId }, 'No matching Subvora product for Shoppex product ID');
    return res.status(404).json(formatShoppexErrorResponse('Product not found'));
  }

  // ── 5. Create order ───────────────────────────────────
  let order;
  try {
    order = await createOrder({
      productId: product.id,
      customerEmail,
      externalOrderId,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create order for Shoppex webhook');
    return res.status(500).json(formatShoppexErrorResponse('Order creation failed'));
  }

  // ── 6. Reserve & fulfill ──────────────────────────────
  const reserved = await reserveInventory(product.id, order.id);
  if (!reserved) {
    logger.error({ productId: product.id, orderId: order.id }, 'No inventory available for Shoppex order');
    return res.status(503).json(formatShoppexErrorResponse('Out of stock'));
  }

  // ── 7. Mark processed & respond ───────────────────────
  try {
    const { fulfillOrder: fulfill } = await import('../services/fulfillment.service.js');
    // Complete the delivery step
    const { completeFulfillment } = await import('../services/inventory.service.js');
    await completeFulfillment(reserved.id, order.id);
    const { updateOrderFulfillment } = await import('../services/order.service.js');
    await updateOrderFulfillment(order.id, 'delivered');

    await markEventProcessed(recorded.id);

    logger.info({ orderId: order.id }, 'Shoppex order fulfilled');

    // Return the entitlement to Shoppex so it can display to the buyer
    return res.status(200).json(formatShoppexResponse({
      entitlementValue: reserved.entitlement_value,
      orderId: order.id,
    }));
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'Shoppex fulfillment delivery step failed');
    return res.status(500).json(formatShoppexErrorResponse('Fulfillment failed'));
  }
}
