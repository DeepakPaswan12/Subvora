-- ════════════════════════════════════════════════════════════════════
--  Subvora Backend — Product Mapping & Inventory Seed
--
--  Run this in your Supabase SQL Editor:
--    Supabase Dashboard → Project → SQL Editor → New Query
--
--  Conceptual Mapping Architecture:
--    Subvora product (UUID, name)
--        ↓
--    whop_product_id (e.g. prod_xxxxxxxxxxxxx)
--        ↓
--    whop_plan_id    (e.g. plan_xxxxxxxxxxxxx)
--
--  When a customer pays on Whop, Whop sends:
--    - product: "prod_..."
--    - plan:    "plan_..."
--
--  The Subvora backend looks up the active product matching BOTH
--  whop_product_id and whop_plan_id. If found, it creates an order
--  and reserves/delivers an available item from the inventory table.
-- ════════════════════════════════════════════════════════════════════

-- Optional: ensure unique constraint on active (whop_product_id, whop_plan_id) pairs
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_whop_product_plan_unique
  ON products (whop_product_id, whop_plan_id)
  WHERE whop_product_id IS NOT NULL AND whop_plan_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────
--  METHOD 1: Create a NEW Subvora product mapped to Whop product & plan
-- ────────────────────────────────────────────────────────────────────
-- Replace:
--   - 'prod_REAL_WHOP_PRODUCT_ID' with your actual Whop Product ID (e.g. prod_AbCdEf123456)
--   - 'plan_REAL_WHOP_PLAN_ID'    with your actual Whop Plan ID (e.g. plan_XyZ789012345)
--   - You can specify your own UUID or let gen_random_uuid() generate one.

INSERT INTO products (
  id,
  name,
  description,
  whop_product_id,
  whop_plan_id,
  active
) VALUES (
  '11111111-1111-1111-1111-111111111111',                  -- Subvora Product ID (UUID)
  'Subvora Pro Digital Access',                             -- Product display name
  'Instant digital license access to Subvora Pro features', -- Description
  'prod_REAL_WHOP_PRODUCT_ID',                              -- whop_product_id from Whop Dashboard
  'plan_REAL_WHOP_PLAN_ID',                                 -- whop_plan_id from Whop Dashboard
  true                                                      -- Must be active to match incoming webhooks
)
ON CONFLICT (id) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  whop_product_id = EXCLUDED.whop_product_id,
  whop_plan_id    = EXCLUDED.whop_plan_id,
  active          = EXCLUDED.active,
  updated_at      = now();


-- ────────────────────────────────────────────────────────────────────
--  METHOD 2: Map an EXISTING Subvora product to Whop product & plan
-- ────────────────────────────────────────────────────────────────────
-- If you already created a product row in Supabase and only know its UUID:
/*
UPDATE products
   SET whop_product_id = 'prod_REAL_WHOP_PRODUCT_ID',
       whop_plan_id    = 'plan_REAL_WHOP_PLAN_ID',
       active          = true,
       updated_at      = now()
 WHERE id = 'YOUR_EXISTING_SUBVORA_PRODUCT_UUID';
*/


-- ────────────────────────────────────────────────────────────────────
--  STEP 2: Add Inventory for the Product (Required for Fulfillment!)
-- ────────────────────────────────────────────────────────────────────
-- When payment.succeeded is received and the product matches, the backend
-- immediately reserves one 'available' item from the inventory table.
-- Insert your digital entitlement keys / license codes below:

INSERT INTO inventory (product_id, entitlement_value, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'SUBVORA-PRO-KEY-A1B2-C3D4-E5F6', 'available'),
  ('11111111-1111-1111-1111-111111111111', 'SUBVORA-PRO-KEY-B2C3-D4E5-F6A1', 'available'),
  ('11111111-1111-1111-1111-111111111111', 'SUBVORA-PRO-KEY-C3D4-E5F6-A1B2', 'available');


-- ────────────────────────────────────────────────────────────────────
--  STEP 3: Verify Your Setup
-- ────────────────────────────────────────────────────────────────────
-- Run this query to confirm the product mapping and inventory stock:

SELECT 
  p.id AS subvora_product_id,
  p.name AS product_name,
  p.whop_product_id,
  p.whop_plan_id,
  p.active,
  COUNT(i.id) FILTER (WHERE i.status = 'available') AS available_inventory_count,
  COUNT(i.id) FILTER (WHERE i.status = 'reserved')  AS reserved_count,
  COUNT(i.id) FILTER (WHERE i.status = 'delivered') AS delivered_count
FROM products p
LEFT JOIN inventory i ON i.product_id = p.id
GROUP BY p.id, p.name, p.whop_product_id, p.whop_plan_id, p.active;
