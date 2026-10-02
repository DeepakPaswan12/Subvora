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
 * Look up the internal Subvora product by Shoppex product ID or title.
 *
 * Matching priority:
 *   1. products.shoppex_product_id
 *   2. products.id (if identifier is a valid UUID)
 *   3. products.name (case-insensitive match using title or identifier)
 *
 * @param {string|object} identifierOrOptions
 * @param {string} [fallbackTitle]
 * @returns {Promise<object|null>}
 */
export async function findSubvoraProductByShoppex(identifierOrOptions, fallbackTitle) {
  let shoppexId = typeof identifierOrOptions === 'string'
    ? identifierOrOptions
    : identifierOrOptions?.shoppexProductId || identifierOrOptions?.productId;
  let title = typeof identifierOrOptions === 'object'
    ? identifierOrOptions?.productTitle || identifierOrOptions?.title
    : fallbackTitle;

  // 1. Try by shoppex_product_id
  if (shoppexId) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, active, shoppex_product_id')
      .eq('shoppex_product_id', shoppexId)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, shoppexId }, 'Failed to look up Subvora product by Shoppex ID');
      throw error;
    }
    if (data) return data;
  }

  // 2. Try by UUID if shoppexId is a valid UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (shoppexId && uuidRegex.test(shoppexId)) {
    const { data } = await supabase
      .from('products')
      .select('id, name, active, shoppex_product_id')
      .eq('id', shoppexId)
      .eq('active', true)
      .maybeSingle();
    if (data) return data;
  }

  // 3. Try by case-insensitive name / title
  const searchTitle = title || shoppexId;
  if (searchTitle) {
    const { data } = await supabase
      .from('products')
      .select('id, name, active, shoppex_product_id')
      .ilike('name', searchTitle.trim())
      .eq('active', true)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}
