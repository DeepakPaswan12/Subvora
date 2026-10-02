import { supabase } from '../db/supabase.js';
import { logger } from '../utils/logger.js';
import { reserveInventory, completeFulfillment } from './inventory.service.js';
import { updateOrderFulfillment } from './order.service.js';

/**
 * Full fulfillment pipeline for an order:
 *   1. Reserve one inventory item
 *   2. Mark order fulfillment as "reserved"
 *   3. Complete delivery
 *   4. Mark order fulfillment as "delivered"
 *
 * If inventory is unavailable, marks the order as fulfillment "failed"
 * and does NOT silently drop the event.
 *
 * @param {string} productId — Subvora product UUID
 * @param {string} orderId   — Subvora order UUID
 * @returns {{ success: boolean, inventoryId?: string }}
 */
export async function fulfillOrder(productId, orderId) {
  // ── Step 1: Reserve inventory ──
  const reserved = await reserveInventory(productId, orderId);

  if (!reserved) {
    logger.error(
      { productId, orderId },
      'FULFILLMENT FAILED: No available inventory. Payment was received but cannot be fulfilled.',
    );
    await updateOrderFulfillment(orderId, 'failed');
    return { success: false };
  }

  await updateOrderFulfillment(orderId, 'reserved');

  // ── Step 2: Deliver ──
  try {
    // In a more complex system this is where you'd call an external
    // delivery API (email, license server, etc.).  For now the
    // entitlement value stored in inventory IS the deliverable.
    await completeFulfillment(reserved.id, orderId);
    await updateOrderFulfillment(orderId, 'delivered');

    logger.info({ orderId, inventoryId: reserved.id }, 'Order fulfilled successfully');
    return { success: true, inventoryId: reserved.id };
  } catch (err) {
    logger.error({ err, orderId, inventoryId: reserved.id }, 'Fulfillment delivery step failed');
    await updateOrderFulfillment(orderId, 'failed');
    return { success: false };
  }
}

/**
 * Look up the internal Subvora product by Whop product or plan ID.
 *
 * @param {object} params
 * @param {string} [params.whopProductId]
 * @param {string} [params.whopPlanId]
 * @returns {object|null}
 */
export async function findSubvoraProduct({ whopProductId, whopPlanId }) {
  if (!whopProductId && !whopPlanId) {
    return null;
  }

  let query = supabase
    .from('products')
    .select('id, name, active, whop_product_id, whop_plan_id')
    .eq('active', true);

  if (whopProductId && whopPlanId) {
    // Both provided: enforce conceptual hierarchy
    // Subvora product -> whop_product_id -> whop_plan_id
    query = query
      .eq('whop_product_id', whopProductId)
      .eq('whop_plan_id', whopPlanId);
  } else if (whopPlanId) {
    query = query.eq('whop_plan_id', whopPlanId);
  } else if (whopProductId) {
    query = query.eq('whop_product_id', whopProductId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error({ err: error, whopProductId, whopPlanId }, 'Failed to look up Subvora product');
    throw error;
  }

  return data;
}

/**
 * Look up the internal Subvora product by Shoppex product ID.
 */
export async function findSubvoraProductByShoppex(shoppexProductId) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, active, shoppex_product_id')
    .eq('shoppex_product_id', shoppexProductId)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, shoppexProductId }, 'Failed to look up Subvora product by Shoppex ID');
    throw error;
  }

  return data;
}
