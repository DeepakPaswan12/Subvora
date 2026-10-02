import { supabase } from '../db/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Reserve one available inventory item atomically for an order.
 *
 * Uses a Supabase RPC call to a PostgreSQL function that performs:
 *   SELECT … FOR UPDATE SKIP LOCKED
 *   UPDATE … SET status = 'reserved'
 * inside a single transaction, preventing race conditions.
 *
 * Falls back to an application-level optimistic update if the RPC
 * function has not been created yet (see schema.sql).
 *
 * @param {string} productId — UUID of the Subvora product
 * @param {string} orderId   — UUID of the order to attach inventory to
 * @returns {{ id: string, entitlement_value: string } | null}
 */
export async function reserveInventory(productId, orderId) {
  // ── Try the atomic RPC first ──────────────────────────
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'reserve_inventory_item',
    { p_product_id: productId, p_order_id: orderId },
  );

  if (!rpcError && rpcData) {
    logger.info({ productId, orderId, inventoryId: rpcData.id }, 'Inventory reserved via RPC');
    return rpcData; // { id, entitlement_value }
  }

  if (rpcError) {
    logger.warn(
      { err: rpcError },
      'reserve_inventory_item RPC unavailable, falling back to app-level reserve',
    );
  }

  // ── Fallback: optimistic application-level reserve ────
  // Step 1: Find an available item
  const { data: available, error: findErr } = await supabase
    .from('inventory')
    .select('id')
    .eq('product_id', productId)
    .eq('status', 'available')
    .limit(1)
    .single();

  if (findErr || !available) {
    logger.warn({ productId }, 'No available inventory for product');
    return null;
  }

  // Step 2: Atomically update ONLY if still 'available'
  const { data: reserved, error: updateErr } = await supabase
    .from('inventory')
    .update({ status: 'reserved', order_id: orderId, updated_at: new Date().toISOString() })
    .eq('id', available.id)
    .eq('status', 'available') // optimistic concurrency guard
    .select('id, entitlement_value')
    .single();

  if (updateErr || !reserved) {
    logger.warn({ inventoryId: available.id }, 'Inventory was claimed by another request');
    return null;
  }

  // Never log entitlement_value
  logger.info({ productId, orderId, inventoryId: reserved.id }, 'Inventory reserved (app-level)');
  return reserved;
}

/**
 * Mark a reserved inventory item as delivered.
 *
 * @param {string} inventoryId
 * @param {string} orderId
 */
export async function completeFulfillment(inventoryId, orderId) {
  const { error } = await supabase
    .from('inventory')
    .update({ status: 'delivered', updated_at: new Date().toISOString() })
    .eq('id', inventoryId)
    .eq('order_id', orderId)
    .eq('status', 'reserved');

  if (error) {
    logger.error({ err: error, inventoryId, orderId }, 'Failed to complete fulfillment');
    throw error;
  }

  logger.info({ inventoryId, orderId }, 'Inventory marked as delivered');
}

/**
 * Release a reserved inventory item back to available.
 *
 * @param {string} inventoryId
 */
export async function releaseInventory(inventoryId) {
  const { error } = await supabase
    .from('inventory')
    .update({ status: 'available', order_id: null, updated_at: new Date().toISOString() })
    .eq('id', inventoryId)
    .eq('status', 'reserved');

  if (error) {
    logger.error({ err: error, inventoryId }, 'Failed to release inventory');
    throw error;
  }

  logger.info({ inventoryId }, 'Inventory released back to available');
}

/**
 * Check available count for a product (for operational monitoring only).
 */
export async function getAvailableCount(productId) {
  const { count, error } = await supabase
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId)
    .eq('status', 'available');

  if (error) {
    logger.error({ err: error, productId }, 'Failed to count available inventory');
    throw error;
  }

  return count || 0;
}
