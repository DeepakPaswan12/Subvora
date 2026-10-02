#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════
 *  Subvora — Product Mapping & Inventory Management CLI
 *
 *  Safe local administrator script.
 *  Uses the local SUPABASE_SERVICE_ROLE_KEY from .env directly.
 *  No public HTTP endpoints. No frontend exposure.
 *
 *  Usage:
 *    node scripts/manage-product.js list
 *    node scripts/manage-product.js create "<Product Name>" "<whop_prod_id>" "<whop_plan_id>"
 *    node scripts/manage-product.js map "<subvora_uuid>" "<whop_prod_id>" "<whop_plan_id>"
 *    node scripts/manage-product.js add-inventory "<subvora_uuid>" "KEY1" "KEY2" "KEY3"
 * ════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'list':
      return listProducts();
    case 'create':
      return createProduct(args[0], args[1], args[2], args[3]);
    case 'map':
      return mapProduct(args[0], args[1], args[2]);
    case 'add-inventory':
      return addInventory(args[0], args.slice(1));
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`
Subvora Product Mapping CLI

Commands:
  list
    Lists all Subvora products, their Whop mappings, and available inventory.

  create "<name>" "<whop_product_id>" "<whop_plan_id>" ["<description>"]
    Creates a new Subvora product mapped to Whop product & plan IDs.

  map "<subvora_product_uuid>" "<whop_product_id>" "<whop_plan_id>"
    Updates an existing Subvora product with Whop product & plan IDs.

  add-inventory "<subvora_product_uuid>" "<key1>" ["<key2>" ...]
    Adds one or more digital entitlement keys to the inventory table.

Examples:
  node scripts/manage-product.js list
  node scripts/manage-product.js create "Subvora Pro" "prod_AbC123" "plan_XyZ789"
  node scripts/manage-product.js map "a1b2c3d4-..." "prod_AbC123" "plan_XyZ789"
  node scripts/manage-product.js add-inventory "a1b2c3d4-..." "KEY-001" "KEY-002"
`);
}

async function listProducts() {
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, whop_product_id, whop_plan_id, active, created_at')
    .order('created_at', { ascending: false });

  if (prodErr) {
    console.error('Failed to list products:', prodErr.message);
    process.exit(1);
  }

  if (!products || products.length === 0) {
    console.log('\nNo products found in the database.');
    console.log('Run `create` or execute supabase/seed.sql to add your first product.\n');
    return;
  }

  console.log('\nSubvora Products & Whop Mappings:\n' + '─'.repeat(80));

  for (const p of products) {
    const { count, error: countErr } = await supabase
      .from('inventory')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', p.id)
      .eq('status', 'available');

    const invCount = countErr ? '?' : count;
    console.log(`Product:             ${p.name}`);
    console.log(`Subvora ID (UUID):   ${p.id}`);
    console.log(`Whop Product ID:     ${p.whop_product_id || '(not mapped)'}`);
    console.log(`Whop Plan ID:        ${p.whop_plan_id || '(not mapped)'}`);
    console.log(`Active:              ${p.active}`);
    console.log(`Available Inventory: ${invCount}`);
    console.log('─'.repeat(80));
  }
}

async function createProduct(name, whopProductId, whopPlanId, description = '') {
  if (!name || !whopProductId || !whopPlanId) {
    console.error('Error: name, whop_product_id, and whop_plan_id are required.');
    console.log('Usage: node scripts/manage-product.js create "<name>" "<whop_product_id>" "<whop_plan_id>"');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      name,
      description,
      whop_product_id: whopProductId,
      whop_plan_id: whopPlanId,
      active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create product:', error.message);
    process.exit(1);
  }

  console.log('\n✓ Product successfully created and mapped:');
  console.log(`  Subvora Product ID: ${data.id}`);
  console.log(`  Name:               ${data.name}`);
  console.log(`  Whop Product ID:    ${data.whop_product_id}`);
  console.log(`  Whop Plan ID:       ${data.whop_plan_id}`);
  console.log(`\nNext step: Add inventory for this product so fulfillment can deliver:`);
  console.log(`  node scripts/manage-product.js add-inventory "${data.id}" "YOUR_LICENSE_KEY_1"\n`);
}

async function mapProduct(productId, whopProductId, whopPlanId) {
  if (!productId || !whopProductId || !whopPlanId) {
    console.error('Error: productId, whop_product_id, and whop_plan_id are required.');
    console.log('Usage: node scripts/manage-product.js map "<subvora_uuid>" "<whop_product_id>" "<whop_plan_id>"');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('products')
    .update({
      whop_product_id: whopProductId,
      whop_plan_id: whopPlanId,
      active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId)
    .select()
    .single();

  if (error) {
    console.error('Failed to map product:', error.message);
    process.exit(1);
  }

  console.log('\n✓ Product mapping updated:');
  console.log(`  Subvora Product ID: ${data.id}`);
  console.log(`  Name:               ${data.name}`);
  console.log(`  Whop Product ID:    ${data.whop_product_id}`);
  console.log(`  Whop Plan ID:       ${data.whop_plan_id}\n`);
}

async function addInventory(productId, keys) {
  if (!productId || !keys || keys.length === 0) {
    console.error('Error: productId and at least one entitlement key are required.');
    console.log('Usage: node scripts/manage-product.js add-inventory "<subvora_uuid>" "KEY1" "KEY2"');
    process.exit(1);
  }

  const rows = keys.map((key) => ({
    product_id: productId,
    entitlement_value: key,
    status: 'available',
  }));

  const { data, error } = await supabase
    .from('inventory')
    .insert(rows)
    .select('id, entitlement_value');

  if (error) {
    console.error('Failed to add inventory:', error.message);
    process.exit(1);
  }

  console.log(`\n✓ Added ${data.length} inventory item(s) for product ${productId}.\n`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
