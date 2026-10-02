import { z } from 'zod';
import { getOrderById } from '../services/order.service.js';

const uuidSchema = z.string().uuid();

/**
 * GET /api/orders/:id
 *
 * Returns safe order information only.
 * Does NOT expose API keys, secrets, raw inventory, or other customers' data.
 */
export async function getOrder(req, res) {
  // Validate UUID format
  const parsed = uuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Order ID must be a valid UUID' },
    });
  }

  const order = await getOrderById(parsed.data);

  if (!order) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Order not found' },
    });
  }

  // Return only safe fields
  return res.status(200).json({
    success: true,
    data: {
      id: order.id,
      product_id: order.product_id,
      status: order.status,
      fulfillment_status: order.fulfillment_status,
      created_at: order.created_at,
      updated_at: order.updated_at,
    },
  });
}
