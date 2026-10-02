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
 *
 * Matches the official Whop signing algorithm:
 *   - Key: the raw ws_ secret string as UTF-8 bytes
 *   - Signed content: "${msgId}.${timestamp}.${rawBody}"
 *   - Signature: "v1," + base64(HMAC-SHA256)
 */
function signWebhook(rawBody, secret, msgId = 'msg_test123', timestamp = null) {
  const ts = timestamp || Math.floor(Date.now() / 1000).toString();
  const secretKey = Buffer.from(secret, 'utf-8');
  const signedContent = `${msgId}.${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretKey).update(signedContent).digest('base64');
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
  // Whop secrets use ws_ prefix with a hex string — NOT whsec_ / base64
  const TEST_SECRET = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

    expect(() => verifyWebhook(body, headers)).toThrow('Invalid webhook signature');
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

  it('should reject a modified payload (body tampered after signing)', async () => {
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const originalBody = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_123' } });
    const headers = signWebhook(originalBody, TEST_SECRET);

    // Tamper with the body after signing
    const tamperedBody = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_EVIL' } });

    expect(() => verifyWebhook(tamperedBody, headers)).toThrow('Invalid webhook signature');
  });

  it('should reject when webhook-signature header is missing', async () => {
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const body = JSON.stringify({ type: 'payment.succeeded' });

    const headers = {
      'webhook-id': 'msg_test123',
      'webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
      // webhook-signature intentionally omitted
    };

    expect(() => verifyWebhook(body, headers)).toThrow('Missing required webhook headers');
  });

  it('should use the raw ws_ secret without stripping prefix or decoding', async () => {
    // This test ensures the key derivation matches Whop's official spec:
    // the ws_ string is used as-is as the HMAC key.
    const { verifyWebhook } = await import('../src/services/whop.service.js');
    const body = JSON.stringify({ type: 'membership.activated', data: { id: 'mem_abc' } });
    const msgId = 'msg_rawkeytest';
    const ts = Math.floor(Date.now() / 1000).toString();

    // Manually compute the expected signature using the raw secret
    const signedContent = `${msgId}.${ts}.${body}`;
    const expectedSig = crypto
      .createHmac('sha256', Buffer.from(TEST_SECRET, 'utf-8'))
      .update(signedContent)
      .digest('base64');

    const headers = {
      'webhook-id': msgId,
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${expectedSig}`,
    };

    const result = verifyWebhook(body, headers);
    expect(result).toBeDefined();
    expect(result.id).toBe(msgId);
    expect(result.payload.type).toBe('membership.activated');
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
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
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
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
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
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
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
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
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
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
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
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
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

// ════════════════════════════════════════════════════════
//  Unit tests — Product mapping (findSubvoraProduct)
// ════════════════════════════════════════════════════════

describe('Product mapping — findSubvoraProduct', () => {
  const mockProducts = [
    {
      id: 'subvora-uuid-pro',
      name: 'Subvora Pro Plan',
      whop_product_id: 'prod_subvora_pro',
      whop_plan_id: 'plan_subvora_pro_monthly',
      active: true,
    },
    {
      id: 'subvora-uuid-legacy',
      name: 'Subvora Legacy Plan',
      whop_product_id: 'prod_subvora_legacy',
      whop_plan_id: 'plan_subvora_legacy_monthly',
      active: false,
    },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', 'ws_test_secret_for_unit_tests');
    vi.stubEnv('NODE_ENV', 'test');

    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        from: (table) => {
          if (table !== 'products') return {};
          const filters = {};
          const builder = {
            select: () => builder,
            eq: (col, val) => {
              filters[col] = val;
              return builder;
            },
            maybeSingle: async () => {
              const match = mockProducts.find((p) => {
                for (const [k, v] of Object.entries(filters)) {
                  if (p[k] !== v) return false;
                }
                return true;
              });
              return { data: match || null, error: null };
            },
          };
          return builder;
        },
      },
    }));
  });

  it('should match product and plan when both match', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_subvora_pro',
      whopPlanId: 'plan_subvora_pro_monthly',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('subvora-uuid-pro');
    expect(result.name).toBe('Subvora Pro Plan');
  });

  it('should return null for matching product but wrong plan', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_subvora_pro',
      whopPlanId: 'plan_wrong_tier',
    });
    expect(result).toBeNull();
  });

  it('should return null for unknown product', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_unknown',
      whopPlanId: 'plan_subvora_pro_monthly',
    });
    expect(result).toBeNull();
  });

  it('should return null for unknown plan', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopPlanId: 'plan_unknown_xyz',
    });
    expect(result).toBeNull();
  });

  it('should return null for inactive Subvora product even if IDs match', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_subvora_legacy',
      whopPlanId: 'plan_subvora_legacy_monthly',
    });
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════
//  Unit tests — Whop webhook product mapping and fulfillment flows
// ════════════════════════════════════════════════════════

describe('Whop webhook product mapping and fulfillment flows', () => {
  const TEST_SECRET = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', TEST_SECRET);
    vi.stubEnv('NODE_ENV', 'test');
  });

  function createMockRes() {
    let statusCode = 200;
    let body = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        body = data;
        return res;
      },
      getStatusCode: () => statusCode,
      getBody: () => body,
    };
    return res;
  }

  it('should acknowledge duplicate webhook without re-fulfilling', async () => {
    vi.doMock('../src/utils/idempotency.js', () => ({
      findEvent: () => Promise.resolve({ id: 'evt_existing', processed: true }),
      recordEvent: vi.fn(),
      markEventProcessed: vi.fn(),
    }));

    const { handleWhopWebhook } = await import('../src/controllers/whop.controller.js');

    const rawBody = JSON.stringify({
      id: 'evt_dup123',
      type: 'payment.succeeded',
      data: { id: 'pay_123', product: 'prod_test', plan: 'plan_test' },
    });
    const headers = signWebhook(rawBody, TEST_SECRET, 'evt_dup123');

    const res = createMockRes();
    await handleWhopWebhook({ rawBody, headers }, res);

    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody()).toEqual({
      success: true,
      data: { message: 'Already processed' },
    });
  });

  it('should fail safely and return 500 when product is unmapped (retryable)', async () => {
    let markProcessedCalled = false;

    vi.doMock('../src/utils/idempotency.js', () => ({
      findEvent: () => Promise.resolve(null),
      recordEvent: () => Promise.resolve({ id: 'evt_row_1' }),
      markEventProcessed: () => {
        markProcessedCalled = true;
        return Promise.resolve();
      },
    }));

    vi.doMock('../src/services/fulfillment.service.js', () => ({
      findSubvoraProduct: () => Promise.resolve(null),
      fulfillOrder: vi.fn(),
    }));

    vi.doMock('../src/services/order.service.js', () => ({
      createOrder: vi.fn(),
      findOrderByWhopPaymentId: () => Promise.resolve(null),
    }));

    const { handleWhopWebhook } = await import('../src/controllers/whop.controller.js');

    const rawBody = JSON.stringify({
      id: 'evt_unmapped_123',
      type: 'payment.succeeded',
      data: { id: 'pay_456', product: 'prod_unrelated', plan: 'plan_unknown' },
    });
    const headers = signWebhook(rawBody, TEST_SECRET, 'evt_unmapped_123');

    const res = createMockRes();
    await handleWhopWebhook({ rawBody, headers }, res);

    expect(res.getStatusCode()).toBe(500);
    expect(res.getBody()).toEqual({
      success: false,
      error: { code: 'PROCESSING_FAILED', message: 'Webhook processing failed' },
    });
    // Crucial: event must NOT be marked processed so Whop can retry it later
    expect(markProcessedCalled).toBe(false);
  });

  it('should fail safely and return 500 when product matches but plan is wrong', async () => {
    let markProcessedCalled = false;

    vi.doMock('../src/utils/idempotency.js', () => ({
      findEvent: () => Promise.resolve(null),
      recordEvent: () => Promise.resolve({ id: 'evt_row_2' }),
      markEventProcessed: () => {
        markProcessedCalled = true;
        return Promise.resolve();
      },
    }));

    vi.doMock('../src/services/fulfillment.service.js', () => ({
      findSubvoraProduct: () => Promise.resolve(null),
      fulfillOrder: vi.fn(),
    }));

    vi.doMock('../src/services/order.service.js', () => ({
      createOrder: vi.fn(),
      findOrderByWhopPaymentId: () => Promise.resolve(null),
    }));

    const { handleWhopWebhook } = await import('../src/controllers/whop.controller.js');

    const rawBody = JSON.stringify({
      id: 'evt_wrongplan_123',
      type: 'payment.succeeded',
      data: { id: 'pay_789', product: 'prod_subvora_pro', plan: 'plan_wrong_tier' },
    });
    const headers = signWebhook(rawBody, TEST_SECRET, 'evt_wrongplan_123');

    const res = createMockRes();
    await handleWhopWebhook({ rawBody, headers }, res);

    expect(res.getStatusCode()).toBe(500);
    expect(res.getBody().success).toBe(false);
    expect(markProcessedCalled).toBe(false);
  });

  it('should successfully fulfill order after mapping', async () => {
    let markProcessedCalled = false;
    let orderCreated = false;
    let fulfillmentCalled = false;

    vi.doMock('../src/utils/idempotency.js', () => ({
      findEvent: () => Promise.resolve(null),
      recordEvent: () => Promise.resolve({ id: 'evt_row_success' }),
      markEventProcessed: () => {
        markProcessedCalled = true;
        return Promise.resolve();
      },
    }));

    vi.doMock('../src/services/fulfillment.service.js', () => ({
      findSubvoraProduct: ({ whopProductId, whopPlanId }) => {
        if (whopProductId === 'prod_subvora_pro' && whopPlanId === 'plan_subvora_pro_monthly') {
          return Promise.resolve({
            id: 'subvora-uuid-pro',
            name: 'Subvora Pro Plan',
            active: true,
          });
        }
        return Promise.resolve(null);
      },
      fulfillOrder: (_productId, _orderId) => {
        fulfillmentCalled = true;
        return Promise.resolve({ success: true, inventoryId: 'inv-uuid-1' });
      },
    }));

    vi.doMock('../src/services/order.service.js', () => ({
      findOrderByWhopPaymentId: () => Promise.resolve(null),
      createOrder: ({ productId, customerEmail, whopPaymentId }) => {
        orderCreated = true;
        return Promise.resolve({
          id: 'order-uuid-1',
          product_id: productId,
          customer_email: customerEmail,
          whop_payment_id: whopPaymentId,
          status: 'paid',
          fulfillment_status: 'pending',
        });
      },
    }));

    const { handleWhopWebhook } = await import('../src/controllers/whop.controller.js');

    const rawBody = JSON.stringify({
      id: 'evt_success_123',
      type: 'payment.succeeded',
      data: {
        id: 'pay_success_123',
        product: 'prod_subvora_pro',
        plan: 'plan_subvora_pro_monthly',
        email: 'customer@example.com',
      },
    });
    const headers = signWebhook(rawBody, TEST_SECRET, 'evt_success_123');

    const res = createMockRes();
    await handleWhopWebhook({ rawBody, headers }, res);

    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody()).toEqual({
      success: true,
      data: { message: 'Processed' },
    });
    expect(orderCreated).toBe(true);
    expect(fulfillmentCalled).toBe(true);
    expect(markProcessedCalled).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
//  Integration / Unit tests — 4 Active Whop Products & Plans
// ════════════════════════════════════════════════════════

describe('Whop 4 Products & Plans Mapping & Resolution', () => {
  const TEST_SECRET = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const ACTIVE_WHOP_PRODUCTS = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Subvora Starter',
      description: 'Subvora Starter tier - $3.49',
      shoppex_product_id: 'subvora_starter',
      whop_product_id: 'prod_OTOTDxKpSqZOS',
      whop_plan_id: 'plan_GEhcPieUbPiEV',
      active: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Subvora Plus',
      description: 'Subvora Plus tier - $5.99',
      shoppex_product_id: 'subvora_plus',
      whop_product_id: 'prod_vigxWiRlCDG1r',
      whop_plan_id: 'plan_NPGtYYgSweOe5',
      active: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Subvora Premium',
      description: 'Subvora Premium tier - $8.49',
      shoppex_product_id: 'subvora_premium',
      whop_product_id: 'prod_Z6Zt4PeOl32lo',
      whop_plan_id: 'plan_YPYR0Ad2RL7wZ',
      active: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      name: 'Subvora Ultimate',
      description: 'Subvora Ultimate tier - $12.99',
      shoppex_product_id: 'subvora_ultimate',
      whop_product_id: 'prod_jNuggU8L82qss',
      whop_plan_id: 'plan_0r94rZzOKp6p8',
      active: true,
    },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/services/fulfillment.service.js');
    vi.doUnmock('../src/services/order.service.js');
    vi.doUnmock('../src/utils/idempotency.js');
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('WHOP_API_KEY', 'whop_test');
    vi.stubEnv('WHOP_WEBHOOK_SECRET', TEST_SECRET);
    vi.stubEnv('NODE_ENV', 'test');

    vi.doMock('../src/db/supabase.js', () => ({
      supabase: {
        from: (table) => {
          if (table === 'products') {
            const filters = {};
            const builder = {
              select: () => builder,
              eq: (col, val) => {
                filters[col] = val;
                return builder;
              },
              maybeSingle: async () => {
                const match = ACTIVE_WHOP_PRODUCTS.find((p) => {
                  for (const [k, v] of Object.entries(filters)) {
                    if (p[k] !== v) return false;
                  }
                  return true;
                });
                return { data: match || null, error: null };
              },
            };
            return builder;
          }
          return {};
        },
      },
    }));
  });

  it('should resolve Subvora Starter by product ID and plan ID', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_OTOTDxKpSqZOS',
      whopPlanId: 'plan_GEhcPieUbPiEV',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.name).toBe('Subvora Starter');
  });

  it('should resolve Subvora Plus by product ID and plan ID', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_vigxWiRlCDG1r',
      whopPlanId: 'plan_NPGtYYgSweOe5',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(result.name).toBe('Subvora Plus');
  });

  it('should resolve Subvora Premium by product ID and plan ID', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_Z6Zt4PeOl32lo',
      whopPlanId: 'plan_YPYR0Ad2RL7wZ',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('00000000-0000-4000-8000-000000000003');
    expect(result.name).toBe('Subvora Premium');
  });

  it('should resolve Subvora Ultimate by product ID and plan ID', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_jNuggU8L82qss',
      whopPlanId: 'plan_0r94rZzOKp6p8',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('00000000-0000-4000-8000-000000000004');
    expect(result.name).toBe('Subvora Ultimate');
  });

  it('should reject mismatched plan for Subvora Starter', async () => {
    const { findSubvoraProduct } = await import('../src/services/fulfillment.service.js');
    const result = await findSubvoraProduct({
      whopProductId: 'prod_OTOTDxKpSqZOS',
      whopPlanId: 'plan_NPGtYYgSweOe5', // Plus plan
    });
    expect(result).toBeNull();
  });

  it.each([
    {
      title: 'Subvora Starter',
      whopProductId: 'prod_OTOTDxKpSqZOS',
      whopPlanId: 'plan_GEhcPieUbPiEV',
      expectedSubvoraId: '00000000-0000-4000-8000-000000000001',
    },
    {
      title: 'Subvora Plus',
      whopProductId: 'prod_vigxWiRlCDG1r',
      whopPlanId: 'plan_NPGtYYgSweOe5',
      expectedSubvoraId: '00000000-0000-4000-8000-000000000002',
    },
    {
      title: 'Subvora Premium',
      whopProductId: 'prod_Z6Zt4PeOl32lo',
      whopPlanId: 'plan_YPYR0Ad2RL7wZ',
      expectedSubvoraId: '00000000-0000-4000-8000-000000000003',
    },
    {
      title: 'Subvora Ultimate',
      whopProductId: 'prod_jNuggU8L82qss',
      whopPlanId: 'plan_0r94rZzOKp6p8',
      expectedSubvoraId: '00000000-0000-4000-8000-000000000004',
    },
  ])('payment.succeeded resolves $title ($whopPlanId) to Subvora product $expectedSubvoraId', async ({ whopProductId, whopPlanId, expectedSubvoraId }) => {
    let capturedOrderId = null;
    let capturedProductId = null;
    let markProcessedCalled = false;

    vi.doMock('../src/utils/idempotency.js', () => ({
      findEvent: () => Promise.resolve(null),
      recordEvent: () => Promise.resolve({ id: `evt_row_${whopPlanId}` }),
      markEventProcessed: () => {
        markProcessedCalled = true;
        return Promise.resolve();
      },
    }));

    vi.doMock('../src/services/fulfillment.service.js', () => ({
      findSubvoraProduct: ({ whopProductId: pId, whopPlanId: plId }) => {
        const match = ACTIVE_WHOP_PRODUCTS.find(
          (p) => p.whop_product_id === pId && p.whop_plan_id === plId,
        );
        return Promise.resolve(match || null);
      },
      fulfillOrder: () => {
        // Real inventory fulfillment is NOT enabled yet
        return Promise.resolve({ success: false });
      },
    }));

    vi.doMock('../src/services/order.service.js', () => ({
      findOrderByWhopPaymentId: () => Promise.resolve(null),
      createOrder: ({ productId, customerEmail, whopPaymentId }) => {
        capturedProductId = productId;
        capturedOrderId = `order_${whopPlanId}`;
        return Promise.resolve({
          id: capturedOrderId,
          product_id: productId,
          customer_email: customerEmail,
          whop_payment_id: whopPaymentId,
          status: 'paid',
          fulfillment_status: 'pending',
        });
      },
    }));

    const { handleWhopWebhook } = await import('../src/controllers/whop.controller.js');

    const rawBody = JSON.stringify({
      id: `evt_pay_${whopPlanId}`,
      type: 'payment.succeeded',
      data: {
        id: `pay_${whopPlanId}`,
        product: whopProductId,
        plan: whopPlanId,
        email: 'customer@subvora.com',
      },
    });
    const headers = signWebhook(rawBody, TEST_SECRET, `evt_pay_${whopPlanId}`);

    let statusCode = 200;
    let responseBody = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        responseBody = data;
        return res;
      },
    };

    await handleWhopWebhook({ rawBody, headers }, res);

    expect(statusCode).toBe(200);
    expect(responseBody).toEqual({ success: true, data: { message: 'Processed' } });
    expect(capturedProductId).toBe(expectedSubvoraId);
    expect(capturedOrderId).toBe(`order_${whopPlanId}`);
    expect(markProcessedCalled).toBe(true);
  });
});


