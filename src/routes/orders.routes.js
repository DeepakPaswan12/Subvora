import { Router } from 'express';
import { getOrder } from '../controllers/orders.controller.js';
import { apiLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.get('/:id', apiLimiter, getOrder);

export default router;
