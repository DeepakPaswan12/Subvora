import { Router } from 'express';
import { handleShoppexWebhook } from '../controllers/shoppex.controller.js';
import { webhookLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.post('/', webhookLimiter, handleShoppexWebhook);

export default router;
