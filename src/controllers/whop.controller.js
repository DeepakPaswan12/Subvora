import { logger } from '../utils/logger.js';
import { verifyWebhook, SUPPORTED_EVENTS } from '../services/whop.service.js';
import { findEvent, recordEvent, markEventProcessed } from '../utils/idempotency.js';
import { createOrder, findOrderByWhopPaymentId } from '../services/order.service.js';
import { fulfillOrder, findSubvoraProduct } from '../services/fulfillment.service.js';

const PROVIDER = 'whop';

/**
 * POST /webhooks/whop
 *
 * Receives, verifies, deduplicates, and processes Whop webhooks.
 */
export async function handleWhopWebhook(req, res) {
  // ── 1. Verify signature ──────────────────────────────
  let verified;
  try {
    verified = verifyWebhook(req.rawBody, req.headers);
  } catch (err) {
    logger.warn({ code: err.code }, 'Whop webhook verification failed');
    return res.status(err.status || 401).json({
      success: false,
      error: { code: err.code || 'WEBHOOK_VERIFICATION_FAILED', message: err.message },
    });
  }

  const { id: eventId, payload } = verified;
  const eventType = payload.type || payload.event || 'unknown';

  logger.info({ eventId, eventType }, 'Whop webhook received');

  // ── 2. Idempotency check ──────────────────────────────
  const existing = await findEvent(PROVIDER, eventId);
  if (existing?.processed) {
    logger.info({ eventId }, 'Whop webhook already processed — skipping');
    return res.status(200).json({ success: true, data: { message: 'Already processed' } });
  }

  // ── 3. Record event ───────────────────────────────────
  const recorded = existing
    ? { id: existing.id }
    : await recordEvent(PROVIDER, eventId, eventType, payload);

  if (!recorded) {
    // Duplicate insert (race condition between step 2 and 3)
    return res.status(200).json({ success: true, data: { message: 'Already processed' } });
  }

  // ── 4. Check if event is supported ────────────────────
  if (!SUPPORTED_EVENTS[eventType]) {
    logger.info({ eventType }, 'Whop event type not handled — acknowledging');
    await markEventProcessed(recorded.id);
    return res.status(200).json({ success: true, data: { message: 'Event acknowledged' } });
  }

  // ── 5. Route to handler ───────────────────────────────
  try {
    await routeEvent(eventType, payload, recorded.id);
    await markEventProcessed(recorded.id);
    return res.status(200).json({ success: true, data: { message: 'Processed' } });
  } catch (err) {
    logger.error(
      { err, eventId, eventType },
      'Whop webhook processing failed — event NOT marked as processed so it can be retried',
    );
    // Return 500 so Whop retries delivery
    return res.status(500).json({
      success: false,
      error: { code: 'PROCESSING_FAILED', message: 'Webhook processing failed' },
    });
  }
}

// ════════════════════════════════════════════════════════
//  Event handlers
// ════════════════════════════════════════════════════════

async function routeEvent(eventType, payload, eventRowId) {
  switch (eventType) {
    case 'payment.succeeded':
      return handlePaymentSucceeded(payload);
    case 'payment.failed':
      return handlePaymentFailed(payload);
    case 'membership.activated':
      return handleMembershipActivated(payload);
    case 'membership.deactivated':
      return handleMembershipDeactivated(payload);
    default:
      logger.warn({ eventType }, 'No handler for event type');
  }
}

/**
 * Helper to safely extract an ID string whether Whop sends a raw string or an object with an `id` field.
 */
function extractIdentifier(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object' && typeof val.id === 'string') return val.id.trim();
  return null;
}

/**
 * payment.succeeded
 *
 * Flow:
 *   1. Extract product/plan identifiers from the payload.
 *   2. Find matching Subvora product.
 *   3. Create order.
 *   4. Fulfill (reserve + deliver inventory).
 */
async function handlePaymentSucceeded(payload) {
  const data = payload.data || payload;

  // Extract identifiers from the Whop payment payload safely
  const whopPaymentId    = extractIdentifier(data.id)         || extractIdentifier(data.payment_id);
  const whopMembershipId = extractIdentifier(data.membership) || extractIdentifier(data.membership_id);
  const whopProductId    = extractIdentifier(data.product)    || extractIdentifier(data.product_id);
  const whopPlanId       = extractIdentifier(data.plan)       || extractIdentifier(data.plan_id);
  const customerEmail    = data.email || data.user_email || (typeof data.user === 'object' ? data.user?.email : null) || null;

  if (!whopProductId && !whopPlanId) {
    logger.error({ whopPaymentId }, 'payment.succeeded missing product/plan identifiers');
    throw new Error('Missing product/plan identifiers in payment.succeeded payload');
  }

  // Prevent duplicate order creation
  if (whopPaymentId) {
    const existingOrder = await findOrderByWhopPaymentId(whopPaymentId);
    if (existingOrder && existingOrder.fulfillment_status === 'delivered') {
      logger.info({ whopPaymentId }, 'Order already fulfilled for this payment');
      return;
    }
  }

  // Find matching Subvora product
  const product = await findSubvoraProduct({ whopProductId, whopPlanId });
  if (!product) {
    logger.error(
      { whopProductId, whopPlanId },
      'No matching active Subvora product found for Whop identifiers. Map this Whop product and plan to a Subvora product in Supabase to fulfill.',
    );
    throw new Error('No matching Subvora product');
  }

  // Create order
  const order = await createOrder({
    productId: product.id,
    customerEmail,
    whopPaymentId,
    whopMembershipId,
  });

  // Fulfill
  const result = await fulfillOrder(product.id, order.id);
  if (!result.success) {
    // fulfillOrder already logged and marked order as failed — do NOT throw
    // so the webhook is still marked processed (we captured the payment event).
    logger.error({ orderId: order.id }, 'Fulfillment failed — manual intervention required');
  }
}

/**
 * payment.failed — log for operational awareness.
 */
async function handlePaymentFailed(payload) {
  const data = payload.data || payload;
  logger.warn(
    { whopPaymentId: data.id || data.payment_id },
    'Whop payment failed — no fulfillment action taken',
  );
}

/**
 * membership.activated — can also trigger fulfillment if desired.
 *
 * TODO: Decide if membership.activated should independently trigger
 *       fulfillment or if it is only informational. Currently it
 *       mirrors payment.succeeded behavior.
 */
async function handleMembershipActivated(payload) {
  const data = payload.data || payload;

  const whopMembershipId = extractIdentifier(data.id)         || extractIdentifier(data.membership_id);
  const whopProductId    = extractIdentifier(data.product)    || extractIdentifier(data.product_id);
  const whopPlanId       = extractIdentifier(data.plan)       || extractIdentifier(data.plan_id);
  const customerEmail    = data.email || data.user_email || (typeof data.user === 'object' ? data.user?.email : null) || null;

  if (!whopProductId && !whopPlanId) {
    logger.info({ whopMembershipId }, 'membership.activated without product — acknowledging');
    return;
  }

  const product = await findSubvoraProduct({ whopProductId, whopPlanId });
  if (!product) {
    logger.warn({ whopProductId, whopPlanId }, 'No matching product for membership.activated');
    return;
  }

  const order = await createOrder({
    productId: product.id,
    customerEmail,
    whopMembershipId,
  });

  await fulfillOrder(product.id, order.id);
}

/**
 * membership.deactivated — operational logging only.
 */
async function handleMembershipDeactivated(payload) {
  const data = payload.data || payload;
  logger.info(
    { whopMembershipId: data.id || data.membership_id },
    'Whop membership deactivated — logged for reference',
  );
}
