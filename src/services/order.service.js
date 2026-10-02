import { supabase } from '../db/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Create a new order.
 *
 * @param {object} params
 * @param {string} params.productId
 * @param {string} [params.customerEmail]
 * @param {string} [params.whopPaymentId]
 * @param {string} [params.whopMembershipId]
 * @param {string} [params.externalOrderId]
 * @returns {object} the created order row
 */
export async function createOrder({
  productId,
  customerEmail = null,
  whopPaymentId = null,
  whopMembershipId = null,
  externalOrderId = null,
}) {
  const { data, error } = await supabase
    .from('orders')
    .insert({
      product_id: productId,
      customer_email: customerEmail,
      whop_payment_id: whopPaymentId,
      whop_membership_id: whopMembershipId,
      external_order_id: externalOrderId,
      status: 'paid',
      fulfillment_status: 'pending',
    })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, 'Failed to create order');
    throw error;
  }

  logger.info({ orderId: data.id, productId }, 'Order created');
  return data;
}

/**
 * Update order fulfillment status.
 */
export async function updateOrderFulfillment(orderId, fulfillmentStatus) {
  const { data, error } = await supabase
    .from('orders')
    .update({
      fulfillment_status: fulfillmentStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error, orderId, fulfillmentStatus }, 'Failed to update order fulfillment');
    throw error;
  }

  return data;
}

/**
 * Update order payment status.
 */
export async function updateOrderStatus(orderId, status) {
  const { data, error } = await supabase
    .from('orders')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error, orderId, status }, 'Failed to update order status');
    throw error;
  }

  return data;
}

/**
 * Retrieve a single order (safe fields only — no raw inventory).
 */
export async function getOrderById(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, product_id, customer_email, status, fulfillment_status, created_at, updated_at')
    .eq('id', orderId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    logger.error({ err: error, orderId }, 'Failed to retrieve order');
    throw error;
  }

  return data;
}

/**
 * Find an existing order by whop payment ID to prevent duplicates.
 */
export async function findOrderByWhopPaymentId(whopPaymentId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, fulfillment_status')
    .eq('whop_payment_id', whopPaymentId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, whopPaymentId }, 'Failed to look up order by Whop payment ID');
    throw error;
  }

  return data;
}

/**
 * Find an existing order by external order ID.
 */
export async function findOrderByExternalId(externalOrderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, fulfillment_status')
    .eq('external_order_id', externalOrderId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, externalOrderId }, 'Failed to look up order by external ID');
    throw error;
  }

  return data;
}
