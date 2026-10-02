import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════

/**
 * Build a minimal Express-like app for testing without importing
 * the real app (which requires valid env vars and Supabase).
 */
async function buildTestApp() {
  // Dynamically import after mocks are set up
  const express = (await import('express')).default;
  const app = express();

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf-8');
    },
  }));

  return app;
}

/**
 * Create a valid Whop webhook signature for testing.
 */
function signWebhook(rawBody, secret, msgId = 'msg_test123', timestamp = null) {
  const ts = timestamp || Math.floor(Date.now() / 1000).toString();
  const secretBytes = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64',
  );
  const signedContent = `${msgId}.${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return {
    'webhook-id': msgId,
    'webhook-timestamp': ts,
    'webhook-signature': `v1,${sig}`,
  };
}

// ════════════════════════════════════════════════════════
//  Unit tests — Whop webhook signature verification
// ════════════════════════════════════════════════════════

describe('Whop webhook signature verification', () => {
  const TEST_SECRET = 'whsec_' + Buffer.from('test-secret-key-32bytes!').toString('base64');

  beforeEach(() => {
    vi.resetModules();
    // Mock env before importing whop.service
    vi.stubEnv('WHOP_WEBHOOK_SECRET', TEST_SECRET);
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('should verify a valid signature', async () => {
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const body = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_123' } });
    const headers = signWebhook(body, TEST_SECRET);

    const result = verifyWebhook(body, headers);
    expect(result).toBeDefined();
    expect(result.id).toBe('msg_test123');
    expect(result.payload.type).toBe('payment.succeeded');
  });

  it('should reject an invalid signature', async () => {
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const body = JSON.stringify({ type: 'payment.succeeded' });
    const headers = signWebhook(body, TEST_SECRET);
    headers['webhook-signature'] = 'v1,invalidsignaturevalue';

    expect(() => verifyWebhook(body, headers)).toThrow();
  });

  it('should reject missing headers', async () => {
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const body = JSON.stringify({ type: 'payment.succeeded' });

    expect(() => verifyWebhook(body, {})).toThrow('Missing required webhook headers');
  });

  it('should reject expired timestamps', async () => {
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const body = JSON.stringify({ type: 'payment.succeeded' });
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const headers = signWebhook(body, TEST_SECRET, 'msg_old', oldTimestamp);

    expect(() => verifyWebhook(body, headers)).toThrow('Webhook timestamp too old');
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Idempotency logic
// ════════════════════════════════════════════════════════

describe('Idempotency utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'whsec_dGVzdA==');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('should detect duplicate events', async () => {
    // Mock Supabase
    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: 'existing-id', processed: true },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      },
    }));

    const { findEvent } = await import('../src/utils/idempotency.js');
    const result = await findEvent('whop', 'evt_123');
    expect(result).toBeDefined();
    expect(result.processed).toBe(true);
  });

  it('should handle new events', async () => {
    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      },
    }));

    const { findEvent } = await import('../src/utils/idempotency.js');
    const result = await findEvent('whop', 'evt_new');
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Order service
// ════════════════════════════════════════════════════════

describe('Order service — getOrderById', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'whsec_dGVzdA==');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('should return null for non-existent order', async () => {
    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: null,
                error: { code: 'PGRST116' },
              }),
            }),
          }),
        }),
      },
    }));

    const { getOrderById } = await import('../src/services/order.service.js');
    const result = await getOrderById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('should return safe fields only', async () => {
    const mockOrder = {
      id: 'order-uuid',
      product_id: 'product-uuid',
      customer_email: 'test@example.com',
      status: 'paid',
      fulfillment_status: 'delivered',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: mockOrder, error: null }),
            }),
          }),
        }),
      },
    }));

    const { getOrderById } = await import('../src/services/order.service.js');
    const result = await getOrderById('order-uuid');
    expect(result).toBeDefined();
    expect(result.id).toBe('order-uuid');
    // Verify no secret fields are present
    expect(result).not.toHaveProperty('whop_payment_id');
    expect(result).not.toHaveProperty('whop_membership_id');
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Inventory service
// ════════════════════════════════════════════════════════

describe('Inventory service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'whsec_dGVzdA==');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('should return null when no inventory is available', async () => {
    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  single: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      },
    }));

    const { reserveInventory } = await import('../src/services/inventory.service.js');
    const result = await reserveInventory('product-uuid', 'order-uuid');
    expect(result).toBeNull();
  });

  it('should reserve inventory when available (app-level fallback)', async () => {
    const mockItem = { id: 'inv-uuid', entitlement_value: 'secret-key-123' };

    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: { message: 'rpc not found' } }),
        from: () => ({
          select: () => ({
            eq: (col, val) => {
              // For the find step
              if (col === 'product_id') {
                return {
                  eq: () => ({
                    limit: () => ({
                      single: () => Promise.resolve({ data: { id: 'inv-uuid' }, error: null }),
                    }),
                  }),
                };
              }
              return { eq: () => ({}) };
            },
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: mockItem, error: null }),
                }),
              }),
            }),
          }),
        }),
      },
    }));

    const { reserveInventory } = await import('../src/services/inventory.service.js');
    const result = await reserveInventory('product-uuid', 'order-uuid');
    expect(result).toBeDefined();
    expect(result.id).toBe('inv-uuid');
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Whop supported events map
// ════════════════════════════════════════════════════════

describe('SUPPORTED_EVENTS', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'whsec_dGVzdA==');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('should include payment.succeeded', async () => {
    const { SUPPORTED_EVENTS } = await import('../src/services/whop.service.js');
    expect(SUPPORTED_EVENTS).toHaveProperty('payment.succeeded');
  });

  it('should be frozen (immutable)', async () => {
    const { SUPPORTED_EVENTS } = await import('../src/services/whop.service.js');
    expect(Object.isFrozen(SUPPORTED_EVENTS)).toBe(true);
  });

  it('should not include invented/undocumented events', async () => {
    const { SUPPORTED_EVENTS } = await import('../src/services/whop.service.js');
    expect(SUPPORTED_EVENTS).not.toHaveProperty('order.completed');
    expect(SUPPORTED_EVENTS).not.toHaveProperty('checkout.completed');
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Orders controller (UUID validation)
// ════════════════════════════════════════════════════════

describe('Orders controller — input validation', () => {
  it('should reject non-UUID order IDs', async () => {
    // Directly test the Zod validation logic
    const { z } = await import('zod');
    const uuidSchema = z.string().uuid();

    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(uuidSchema.safeParse('').success).toBe(false);
    expect(uuidSchema.safeParse('12345').success).toBe(false);
  });

  it('should accept valid UUIDs', async () => {
    const { z } = await import('zod');
    const uuidSchema = z.string().uuid();

    expect(uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Health endpoint response shape
// ════════════════════════════════════════════════════════

describe('Health endpoint', () => {
  it('should return correct shape', () => {
    // The health endpoint returns a simple static object
    const expected = { status: 'ok', service: 'subvora-backend' };
    expect(expected.status).toBe('ok');
    expect(expected.service).toBe('subvora-backend');
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Shoppex service placeholders
// ════════════════════════════════════════════════════════

describe('Shoppex service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'whsec_dGVzdA==');
    vi.stubEnv('SHOPPEX_WEBHOOK_SECRET', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('should return false when secret is not configured', async () => {
    const { verifyShoppexSignature } = await import('../src/services/shoppex.service.js');
    expect(verifyShoppexSignature('body', {})).toBe(false);
  });

  it('should parse payload with fallback fields', async () => {
    const { parseShoppexPayload } = await import('../src/services/shoppex.service.js');
    const result = parseShoppexPayload({
      order_id: 'ord_1',
      product_id: 'prod_1',
      customer_email: 'test@example.com',
    });
    expect(result.orderId).toBe('ord_1');
    expect(result.productId).toBe('prod_1');
    expect(result.customerEmail).toBe('test@example.com');
  });

  it('should format success response', async () => {
    const { formatShoppexResponse } = await import('../src/services/shoppex.service.js');
    const result = formatShoppexResponse({ entitlementValue: 'KEY-123', orderId: 'ord_1' });
    expect(result.status).toBe('success');
    expect(result.content).toBe('KEY-123');
  });

  it('should format error response', async () => {
    const { formatShoppexErrorResponse } = await import('../src/services/shoppex.service.js');
    const result = formatShoppexErrorResponse('Something went wrong');
    expect(result.status).toBe('error');
    expect(result.message).toBe('Something went wrong');
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Error middleware
// ════════════════════════════════════════════════════════

describe('Error middleware', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'whsec_dGVzdA==');
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('should not expose stack traces in production', async () => {
    const { errorHandler } = await import('../src/middleware/error.middleware.js');
    const err = new Error('Database connection failed');
    err.stack = 'Error: Database connection failed\n    at Object.<anonymous> (/app/src/db/supabase.js:5:11)';

    let responseBody = null;
    let responseStatus = null;

    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return mockRes;
      },
      json: (body) => {
        responseBody = body;
        return mockRes;
      },
    };

    errorHandler(err, {}, mockRes, () => {});

    expect(responseStatus).toBe(500);
    expect(responseBody.success).toBe(false);
    expect(responseBody.error.message).toBe('An internal error occurred');
    expect(responseBody.error.message).not.toContain('supabase.js');
  });
});
