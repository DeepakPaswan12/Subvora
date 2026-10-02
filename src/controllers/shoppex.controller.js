import { logger } from '../utils/logger.js';
import {
  verifyShoppexSignature,
  parseShoppexPayload,
  formatShoppexSuccessResponse,
  formatShoppexPendingResponse,
  formatShoppexErrorResponse,
  formatShoppexResponse,
} from '../services/shoppex.service.js';
import { findEvent, recordEvent, markEventProcessed } from '../utils/idempotency.js';
import { createOrder, findOrderByExternalId, updateOrderFulfillment } from '../services/order.service.js';
import { findSubvoraProductByShoppex } from '../services/fulfillment.service.js';
import { reserveInventory, completeFulfillment, getInventoryByOrderId } from '../services/inventory.service.js';

const PROVIDER = 'shoppex';

/**
 * POST /webhooks/shoppex/delivery
 *
 * Shoppex Dynamic Delivery callback.
 * Invoked synchronously by Shoppex upon paid invoice completion.
 * Expects 2xx with JSON content or pending status within 15 seconds.
 */
export async function handleShoppexDeliveryWebhook(req, res) {
  // ── 1. Verify HMAC-SHA256 signature ─────────────────
  const verification = verifyShoppexSignature({
    rawBody: req.rawBody,
    headers: req.headers,
  });

  if (!verification.valid) {
    logger.warn({ code: verification.code }, 'Shoppex dynamic delivery signature invalid');
    return res.status(401).json(formatShoppexErrorResponse(verification.message || 'Invalid signature'));
  }

  // ── 2. Parse and normalize payload ───────────────────
  let parsed;
  try {
    parsed = parseShoppexPayload(req.body, req.headers);
  } catch (err) {
    logger.warn({ err: err.message }, 'Shoppex dynamic delivery payload parsing failed');
    return res.status(400).json(formatShoppexErrorResponse(err.message || 'Malformed payload'));
  }

  const { deliveryId, idempotencyKey, invoiceId, productId, productTitle, customerEmail } = parsed;
  const fulfillmentKey = idempotencyKey || deliveryId;

  logger.info({ deliveryId, invoiceId, productId, productTitle }, 'Shoppex delivery request received');

  // ── 3. Idempotency & Duplicate Delivery Check ────────
  // If Shoppex retries the same delivery/order, return the previously delivered item
  const existingOrder = await findOrderByExternalId(fulfillmentKey);
  if (existingOrder) {
    logger.info({ orderId: existingOrder.id, fulfillmentKey }, 'Shoppex order already exists for key');
    const deliveredItem = await getInventoryByOrderId(existingOrder.id);
    if (deliveredItem) {
      logger.info({ orderId: existingOrder.id }, 'Returning existing delivered item idempotently');
      return res.status(200).json(formatShoppexSuccessResponse({
        entitlementValue: deliveredItem.entitlement_value,
        orderId: existingOrder.id,
      }));
    }
  }

  const existingEvent = await findEvent(PROVIDER, fulfillmentKey);
  if (existingEvent?.processed) {
    logger.info({ fulfillmentKey }, 'Shoppex event already marked processed');
    if (existingOrder) {
      const deliveredItem = await getInventoryByOrderId(existingOrder.id);
      if (deliveredItem) {
        return res.status(200).json(formatShoppexSuccessResponse({
          entitlementValue: deliveredItem.entitlement_value,
          orderId: existingOrder.id,
        }));
      }
    }
  }

  // Record event (safely handles duplicate unique key)
  const recorded = existingEvent
    ? { id: existingEvent.id }
    : await recordEvent(PROVIDER, fulfillmentKey, 'dynamic_delivery', req.body);

  // If already recorded and already being handled / completed
  if (!recorded && existingOrder) {
    const deliveredItem = await getInventoryByOrderId(existingOrder.id);
    if (deliveredItem) {
      return res.status(200).json(formatShoppexSuccessResponse({
        entitlementValue: deliveredItem.entitlement_value,
        orderId: existingOrder.id,
      }));
    }
  }

  // ── 4. Product resolution ────────────────────────────
  const product = await findSubvoraProductByShoppex({ shoppexProductId: productId, productTitle });
  if (!product) {
    logger.error({ productId, productTitle }, 'No matching Subvora product for Shoppex dynamic delivery');
    return res.status(404).json(formatShoppexErrorResponse('Product not found'));
  }

  // ── 5. Create order ──────────────────────────────────
  let order = existingOrder;
  if (!order) {
    try {
      order = await createOrder({
        productId: product.id,
        customerEmail,
        externalOrderId: fulfillmentKey,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to create order for Shoppex delivery');
      return res.status(500).json(formatShoppexErrorResponse('Order creation failed'));
    }
  }

  // ── 6. Reserve inventory atomically ──────────────────
  // Uses PostgreSQL SELECT ... FOR UPDATE SKIP LOCKED
  const reserved = await reserveInventory(product.id, order.id);
  if (!reserved) {
    logger.warn({ productId: product.id, orderId: order.id }, 'Out of stock for Shoppex product');
    await updateOrderFulfillment(order.id, 'failed');
    // Shoppex official spec: 200 with status: "pending" flags the line item as AWAITING_FULFILLMENT
    return res.status(200).json(formatShoppexPendingResponse('Out of stock — awaiting replenishment'));
  }

  // ── 7. Complete fulfillment & respond ────────────────
  try {
    await completeFulfillment(reserved.id, order.id);
    await updateOrderFulfillment(order.id, 'delivered');
    if (recorded?.id) {
      await markEventProcessed(recorded.id);
    }

    logger.info({ orderId: order.id, deliveryId: fulfillmentKey }, 'Shoppex delivery fulfilled successfully');

    return res.status(200).json(formatShoppexSuccessResponse({
      entitlementValue: reserved.entitlement_value,
      orderId: order.id,
    }));
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'Failed to complete fulfillment for Shoppex order');
    return res.status(500).json(formatShoppexErrorResponse('Fulfillment failed'));
  }
}

/**
 * Backward compatibility alias
 */
export const handleShoppexWebhook = handleShoppexDeliveryWebhook;
