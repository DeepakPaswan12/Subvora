import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { logger } from './utils/logger.js';

// ── Routes ─────────────────────────────────────────────
import healthRoutes  from './routes/health.routes.js';
import whopRoutes    from './routes/whop.routes.js';
import shoppexRoutes from './routes/shoppex.routes.js';
import ordersRoutes  from './routes/orders.routes.js';

// ── App ────────────────────────────────────────────────
const app = express();

// ── Security headers ───────────────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────────────
app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// ── Trust proxy (Render / reverse-proxy deployments) ───
app.set('trust proxy', 1);

// ── Body parsing ───────────────────────────────────────
// Webhook endpoints need the raw body for signature verification.
// We capture it on every JSON request and attach as req.rawBody.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf-8');
    },
  }),
);

// ── Request logging ────────────────────────────────────
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming request');
  next();
});

// ── Mount routes ───────────────────────────────────────
app.use('/health',           healthRoutes);
app.use('/webhooks/whop',    whopRoutes);
app.use('/webhooks/shoppex', shoppexRoutes);
app.use('/api/orders',       ordersRoutes);

// ── 404 & error handler ───────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
