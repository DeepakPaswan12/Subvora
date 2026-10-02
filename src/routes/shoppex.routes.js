import { Router } from 'express';
import { handleShoppexDeliveryWebhook } from '../controllers/shoppex.controller.js';
import { webhookLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

// Primary endpoint: POST /webhooks/shoppex/delivery
router.post('/delivery', webhookLimiter, handleShoppexDeliveryWebhook);

// Backward compatibility alias: POST /webhooks/shoppex
router.post('/', webhookLimiter, handleShoppexDeliveryWebhook);

export default router;
