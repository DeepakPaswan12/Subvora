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
--  Active Whop Products & Plans:
--    1. Subvora Starter  ($3.49)  -> prod_OTOTDxKpSqZOS / plan_GEhcPieUbPiEV
--    2. Subvora Plus     ($5.99)  -> prod_vigxWiRlCDG1r / plan_NPGtYYgSweOe5
--    3. Subvora Premium  ($8.49)  -> prod_Z6Zt4PeOl32lo / plan_YPYR0Ad2RL7wZ
--    4. Subvora Ultimate ($12.99) -> prod_jNuggU8L82qss / plan_0r94rZzOKp6p8
-- ════════════════════════════════════════════════════════════════════

-- Ensure unique constraint on active (whop_product_id, whop_plan_id) pairs
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_whop_product_plan_unique
  ON products (whop_product_id, whop_plan_id)
  WHERE whop_product_id IS NOT NULL AND whop_plan_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────
--  STEP 1: Seed the 4 Subvora Products mapped to Whop Products & Plans
-- ────────────────────────────────────────────────────────────────────

-- 1. Subvora Starter
INSERT INTO products (
  id,
  name,
  description,
  shoppex_product_id,
  whop_product_id,
  whop_plan_id,
  active
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Subvora Starter',
  'Subvora Starter tier - $3.49',
  'subvora_starter',
  'prod_OTOTDxKpSqZOS',
  'plan_GEhcPieUbPiEV',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  shoppex_product_id = EXCLUDED.shoppex_product_id,
  whop_product_id    = EXCLUDED.whop_product_id,
  whop_plan_id       = EXCLUDED.whop_plan_id,
  active             = EXCLUDED.active,
  updated_at         = now();

-- 2. Subvora Plus
INSERT INTO products (
  id,
  name,
  description,
  shoppex_product_id,
  whop_product_id,
  whop_plan_id,
  active
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  'Subvora Plus',
  'Subvora Plus tier - $5.99',
  'subvora_plus',
  'prod_vigxWiRlCDG1r',
  'plan_NPGtYYgSweOe5',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  shoppex_product_id = EXCLUDED.shoppex_product_id,
  whop_product_id    = EXCLUDED.whop_product_id,
  whop_plan_id       = EXCLUDED.whop_plan_id,
  active             = EXCLUDED.active,
  updated_at         = now();

-- 3. Subvora Premium
INSERT INTO products (
  id,
  name,
  description,
  shoppex_product_id,
  whop_product_id,
  whop_plan_id,
  active
) VALUES (
  '00000000-0000-4000-8000-000000000003',
  'Subvora Premium',
  'Subvora Premium tier - $8.49',
  'subvora_premium',
  'prod_Z6Zt4PeOl32lo',
  'plan_YPYR0Ad2RL7wZ',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  shoppex_product_id = EXCLUDED.shoppex_product_id,
  whop_product_id    = EXCLUDED.whop_product_id,
  whop_plan_id       = EXCLUDED.whop_plan_id,
  active             = EXCLUDED.active,
  updated_at         = now();

-- 4. Subvora Ultimate
INSERT INTO products (
  id,
  name,
  description,
  shoppex_product_id,
  whop_product_id,
  whop_plan_id,
  active
) VALUES (
  '00000000-0000-4000-8000-000000000004',
  'Subvora Ultimate',
  'Subvora Ultimate tier - $12.99',
  'subvora_ultimate',
  'prod_jNuggU8L82qss',
  'plan_0r94rZzOKp6p8',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  shoppex_product_id = EXCLUDED.shoppex_product_id,
  whop_product_id    = EXCLUDED.whop_product_id,
  whop_plan_id       = EXCLUDED.whop_plan_id,
  active             = EXCLUDED.active,
  updated_at         = now();

-- 5. CapCut Pro — 1 Month (Shoppex Dynamic Product)
INSERT INTO products (
  id,
  name,
  description,
  shoppex_product_id,
  active
) VALUES (
  '20e6b592-d3ee-4c89-a38b-cfd262548331',
  'CapCut Pro — 1 Month',
  'CapCut Pro subscription - 1 Month access',
  '01a0fce5-de64-77a3-98d2-9b8c13b353bd',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  shoppex_product_id = EXCLUDED.shoppex_product_id,
  active             = EXCLUDED.active,
  updated_at         = now();


-- ────────────────────────────────────────────────────────────────────
--  STEP 2: Inventory Fulfillment (Kept Unseeded Until Ready)
-- ────────────────────────────────────────────────────────────────────
-- NOTE: Real inventory fulfillment is NOT enabled yet.
-- When you are ready to distribute digital license keys / entitlements,
-- insert them here. Example:
/*
INSERT INTO inventory (product_id, entitlement_value, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'STARTER-KEY-1', 'available'),
  ('00000000-0000-4000-8000-000000000002', 'PLUS-KEY-1', 'available'),
  ('00000000-0000-4000-8000-000000000003', 'PREMIUM-KEY-1', 'available'),
  ('00000000-0000-4000-8000-000000000004', 'ULTIMATE-KEY-1', 'available');
*/


-- ────────────────────────────────────────────────────────────────────
--  STEP 3: Verify Your Setup
-- ────────────────────────────────────────────────────────────────────
SELECT 
  p.id AS subvora_product_id,
  p.name AS product_name,
  p.shoppex_product_id,
  p.whop_product_id,
  p.whop_plan_id,
  p.active,
  COUNT(i.id) FILTER (WHERE i.status = 'available') AS available_inventory_count
FROM products p
LEFT JOIN inventory i ON i.product_id = p.id
WHERE p.active = true
GROUP BY p.id, p.name, p.shoppex_product_id, p.whop_product_id, p.whop_plan_id, p.active
ORDER BY p.name ASC;
