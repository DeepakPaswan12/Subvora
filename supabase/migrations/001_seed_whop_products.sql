-- ════════════════════════════════════════════════════════════════════
--  Migration: 001_seed_whop_products.sql
--  Adds the 4 Subvora Whop products and plan mappings.
--
--  1. Subvora Starter ($3.49)  -> prod_OTOTDxKpSqZOS / plan_GEhcPieUbPiEV
--  2. Subvora Plus ($5.99)     -> prod_vigxWiRlCDG1r / plan_NPGtYYgSweOe5
--  3. Subvora Premium ($8.49)  -> prod_Z6Zt4PeOl32lo / plan_YPYR0Ad2RL7wZ
--  4. Subvora Ultimate ($12.99)-> prod_jNuggU8L82qss / plan_0r94rZzOKp6p8
-- ════════════════════════════════════════════════════════════════════

-- Ensure composite unique index exists on (whop_product_id, whop_plan_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_whop_product_plan_unique
  ON products (whop_product_id, whop_plan_id)
  WHERE whop_product_id IS NOT NULL AND whop_plan_id IS NOT NULL;

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

-- Deactivate old placeholder product if present
UPDATE products
   SET active = false
 WHERE id = '11111111-1111-1111-1111-111111111111'
   AND whop_product_id = 'prod_REAL_WHOP_PRODUCT_ID';
