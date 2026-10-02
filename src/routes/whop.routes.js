import { Router } from 'express';
import { handleWhopWebhook } from '../controllers/whop.controller.js';
import { webhookLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.post('/', webhookLimiter, handleWhopWebhook);

export default router;
