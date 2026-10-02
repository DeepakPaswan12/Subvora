-- ════════════════════════════════════════════════════════
--  Subvora Backend — PostgreSQL Schema
--  Run once against your Supabase project's SQL editor.
-- ════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. customers ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  whop_user_id  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
  ON customers (email);
CREATE INDEX IF NOT EXISTS idx_customers_whop_user_id
  ON customers (whop_user_id)
  WHERE whop_user_id IS NOT NULL;

-- ── 2. products ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  shoppex_product_id  TEXT,
  whop_product_id     TEXT,
  whop_plan_id        TEXT,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_whop_product_id
  ON products (whop_product_id)
  WHERE whop_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_whop_plan_id
  ON products (whop_plan_id)
  WHERE whop_plan_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_whop_product_plan
  ON products (whop_product_id, whop_plan_id)
  WHERE whop_product_id IS NOT NULL AND whop_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_shoppex_product_id
  ON products (shoppex_product_id)
  WHERE shoppex_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_active
  ON products (active)
  WHERE active = true;

-- ── 3. orders ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id),
  customer_email      TEXT,
  whop_payment_id     TEXT,
  whop_membership_id  TEXT,
  external_order_id   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  fulfillment_status  TEXT NOT NULL DEFAULT 'pending'
                        CHECK (fulfillment_status IN ('pending','reserved','delivered','failed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_product_id
  ON orders (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_whop_payment_id
  ON orders (whop_payment_id)
  WHERE whop_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_external_order_id
  ON orders (external_order_id)
  WHERE external_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status
  ON orders (fulfillment_status);

-- ── 4. inventory ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id),
  entitlement_value TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available','reserved','delivered','cancelled')),
  order_id          UUID REFERENCES orders(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_status
  ON inventory (product_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_order_id
  ON inventory (order_id)
  WHERE order_id IS NOT NULL;

-- ── 5. webhook_events ───────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  processed    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Idempotency constraint: no duplicate (provider, event_id) pairs
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id
  ON webhook_events (provider, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed
  ON webhook_events (processed)
  WHERE processed = false;

-- ════════════════════════════════════════════════════════
--  Atomic inventory reservation function
--  Called via Supabase RPC: supabase.rpc('reserve_inventory_item', ...)
-- ════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reserve_inventory_item(
  p_product_id UUID,
  p_order_id   UUID
)
RETURNS TABLE(id UUID, entitlement_value TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Lock exactly one available row, skipping any that are already locked
  SELECT inv.id, inv.entitlement_value
    INTO v_item
    FROM inventory inv
   WHERE inv.product_id = p_product_id
     AND inv.status = 'available'
   ORDER BY inv.created_at
   LIMIT 1
     FOR UPDATE SKIP LOCKED;

  IF v_item IS NULL THEN
    RETURN;  -- no rows → empty result set
  END IF;

  UPDATE inventory
     SET status     = 'reserved',
         order_id   = p_order_id,
         updated_at = now()
   WHERE inventory.id = v_item.id;

  RETURN QUERY SELECT v_item.id, v_item.entitlement_value;
END;
$$;

-- ════════════════════════════════════════════════════════
--  Row-Level Security (RLS)
--
--  The backend uses the service-role key which bypasses RLS.
--  These policies are a defence-in-depth layer in case the
--  anon key is ever accidentally used.
-- ════════════════════════════════════════════════════════

ALTER TABLE customers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events  ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (it already bypasses RLS,
-- but explicit policies help document intent).
-- No anon/public access policies are created.
