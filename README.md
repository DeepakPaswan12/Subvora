# Subvora Backend

Production-ready Node.js + Express backend for the **Subvora** digital-commerce store.

Handles Whop checkout payments, webhook verification, inventory fulfillment, and a Shoppex Dynamic Webhook adapter.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Install Dependencies](#install-dependencies)
3. [Create Supabase Project](#create-supabase-project)
4. [Run schema.sql](#run-schemasql)
5. [Configure .env](#configure-env)
6. [Run Locally](#run-locally)
7. [Test /health](#test-health)
8. [Configure Whop Webhook](#configure-whop-webhook)
9. [Configure Shoppex Dynamic Webhook](#configure-shoppex-dynamic-webhook)
10. [Deploy to Render](#deploy-to-render)
11. [Configure Render Environment Variables](#configure-render-environment-variables)
12. [Security Considerations](#security-considerations)
13. [How to Add Authorized Inventory](#how-to-add-authorized-inventory)
14. [How to Test Webhook Delivery](#how-to-test-webhook-delivery)

---

## Requirements

- **Node.js** ≥ 20.0.0
- **npm** ≥ 9
- A **Supabase** project (free tier works)
- A **Whop** seller account with API access
- (Optional) A **Shoppex** account for Dynamic Webhook integration

---

## Install Dependencies

```bash
cd subvora-backend
npm install
```

---

## Create Supabase Project

1. Go to <https://supabase.com/dashboard> and create a new project.
2. Note your **Project URL** and **Service Role Key** from
   Settings → API.

> ⚠️ The service-role key bypasses Row-Level Security. Never expose it to
> the frontend or commit it to Git.

---

## Run schema.sql

1. Open the **SQL Editor** in your Supabase dashboard.
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Click **Run**.

This creates all tables, indexes, the idempotency constraint, the atomic
inventory reservation function, and enables RLS.

---

## Configure .env

```bash
cp .env.example .env
```

Fill in the values:

| Variable                  | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `PORT`                    | Server port (default: `3000`)                  |
| `NODE_ENV`                | `development`, `production`, or `test`         |
| `SUPABASE_URL`            | Your Supabase project URL                      |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key from Supabase dashboard     |
| `WHOP_API_KEY`            | Your Whop API key (starts with `whop_`)        |
| `WHOP_WEBHOOK_SECRET`     | Webhook signing secret (starts with `ws_`)     |
| `SHOPPEX_WEBHOOK_SECRET`  | Shoppex webhook secret (when available)        |
| `CORS_ORIGIN`             | Frontend origin URL                            |

---

## Run Locally

```bash
# Development mode with file watching
npm run dev

# Production mode
npm start
```

---

## Test /health

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "subvora-backend"
}
```

---

## Configure Whop Webhook

1. Go to **Whop Dashboard** → Developer → Webhooks.
2. Create a new webhook endpoint:
   ```
   https://<your-render-service>.onrender.com/webhooks/whop
   ```
3. Subscribe to events:
   - `payment.succeeded`
   - `payment.failed`
   - `membership.activated`
   - `membership.deactivated`
4. Copy the **signing secret** (starts with `whsec_`).
5. Set `WHOP_WEBHOOK_SECRET` in your `.env` or Render env vars.

See [`WHOP_WEBHOOK_EVENTS.md`](WHOP_WEBHOOK_EVENTS.md) for full details.

---

## Configure Shoppex Dynamic Webhook

1. In your Shoppex seller dashboard, set the Dynamic Webhook URL to:
   ```
   https://<your-render-service>.onrender.com/webhooks/shoppex
   ```
2. Set `SHOPPEX_WEBHOOK_SECRET` in your env vars.

> ⚠️ The Shoppex integration is currently an **adapter with placeholder logic**.
> See [`SHOPPEX_WEBHOOK.md`](SHOPPEX_WEBHOOK.md) for what needs to be updated
> once the official Shoppex documentation is available.

---

## Deploy to Render

### Option A: Blueprint (recommended)

1. Push this repository to GitHub/GitLab.
2. Go to <https://dashboard.render.com/> → **New** → **Blueprint**.
3. Connect your repo. Render will detect `render.yaml`.
4. Set environment variables when prompted.

### Option B: Manual

1. Go to <https://dashboard.render.com/> → **New** → **Web Service**.
2. Connect your repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/health`
4. Add environment variables.

---

## Configure Render Environment Variables

In your Render dashboard, add these env vars:

| Key                         | Value                        |
| --------------------------- | ---------------------------- |
| `NODE_ENV`                  | `production`                 |
| `SUPABASE_URL`              | `https://xxx.supabase.co`   |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase dashboard)*  |
| `WHOP_API_KEY`              | *(from Whop dashboard)*      |
| `WHOP_WEBHOOK_SECRET`       | *(from Whop webhook config)* |
| `SHOPPEX_WEBHOOK_SECRET`    | *(from Shoppex, when ready)* |
| `CORS_ORIGIN`               | `https://your-storefront.com`|

---

## Security Considerations

- **Helmet** sets secure HTTP headers.
- **CORS** restricts origins.
- **Rate limiting** protects against abuse (100 req/15min API, 60 req/min webhooks).
- **Request size** limited to 1 MB.
- **Webhook signatures** are verified using HMAC-SHA256 (Standard Webhooks spec).
- **Idempotency** prevents duplicate processing via `(provider, event_id)` unique constraint.
- **Input validation** via Zod schemas.
- **No secrets in logs** — pino redacts sensitive fields.
- **No stack traces** in production error responses.
- **RLS enabled** on all Supabase tables.
- **No admin endpoints** are exposed — inventory must be added via Supabase dashboard or a future authenticated admin API.

---

## How to Add Authorized Inventory

Since no public admin API exists (by design), add inventory through the
**Supabase dashboard** SQL Editor:

### Product Mapping Architecture

```
Subvora Product (UUID, name)
       ↓
whop_product_id (e.g. prod_xxxxxxxxxxxxx)
       ↓
whop_plan_id    (e.g. plan_xxxxxxxxxxxxx)
```

### Method A: Using Supabase SQL Editor (Recommended)

Execute [`supabase/seed.sql`](supabase/seed.sql) in your Supabase SQL Editor:

```sql
-- 1. Create the Subvora product mapped to Whop product & plan IDs
INSERT INTO products (
  id,
  name,
  description,
  whop_product_id,
  whop_plan_id,
  active
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Subvora Pro Digital Access',
  'Instant digital license access to Subvora Pro features',
  'prod_YOUR_REAL_WHOP_PRODUCT_ID',
  'plan_YOUR_REAL_WHOP_PLAN_ID',
  true
);

-- 2. Add inventory items (one per entitlement)
INSERT INTO inventory (product_id, entitlement_value, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'LICENSE-KEY-001', 'available'),
  ('11111111-1111-1111-1111-111111111111', 'LICENSE-KEY-002', 'available'),
  ('11111111-1111-1111-1111-111111111111', 'LICENSE-KEY-003', 'available');
```

### Method B: Using the Local Admin CLI

Run locally without exposing any public HTTP endpoints:

```bash
# List all products and inventory counts
npm run manage:products list

# Create a new product and map Whop IDs
npm run manage:products create "Subvora Pro" "prod_YOUR_REAL_WHOP_PRODUCT_ID" "plan_YOUR_REAL_WHOP_PLAN_ID"

# Map an existing product by UUID
npm run manage:products map "11111111-1111-1111-1111-111111111111" "prod_YOUR_REAL_WHOP_PRODUCT_ID" "plan_YOUR_REAL_WHOP_PLAN_ID"

# Add inventory items for fulfillment
npm run manage:products add-inventory "11111111-1111-1111-1111-111111111111" "KEY-001" "KEY-002"
```

> 🔒 **Important:** Only add products/entitlements that you are authorized to
> distribute. The `whop_product_id` and `whop_plan_id` must match products you
> own in your Whop seller account. Do NOT use Whop test product IDs (e.g. Ceramic Coating Package)
> for your real Subvora products.

---

## How to Test Webhook Delivery

### Local development with ngrok

```bash
# Start the server
npm run dev

# In another terminal, expose it via ngrok
ngrok http 3000
```

Use the ngrok HTTPS URL as your webhook endpoint in the Whop dashboard.

### Test the health endpoint

```bash
curl http://localhost:3000/health
```

### Test order lookup (with a valid UUID)

```bash
curl http://localhost:3000/api/orders/550e8400-e29b-41d4-a716-446655440000
```

### Whop test event

Use the **"Send test event"** button in the Whop Dashboard webhook
configuration to send a test `payment.succeeded` event.

### Run automated tests

```bash
npm test
```

---

## Project Structure

```
subvora-backend/
├── src/
│   ├── server.js                 # Entrypoint — binds to 0.0.0.0
│   ├── app.js                    # Express app configuration
│   ├── config/
│   │   └── env.js                # Zod-validated environment config
│   ├── routes/
│   │   ├── health.routes.js      # GET /health
│   │   ├── whop.routes.js        # POST /webhooks/whop
│   │   ├── shoppex.routes.js     # POST /webhooks/shoppex
│   │   └── orders.routes.js      # GET /api/orders/:id
│   ├── controllers/
│   │   ├── whop.controller.js    # Whop webhook handler
│   │   ├── shoppex.controller.js # Shoppex webhook adapter
│   │   └── orders.controller.js  # Order lookup
│   ├── services/
│   │   ├── whop.service.js       # Whop API + signature verification
│   │   ├── inventory.service.js  # Atomic inventory operations
│   │   ├── order.service.js      # Order CRUD
│   │   ├── fulfillment.service.js# Fulfillment orchestration
│   │   └── shoppex.service.js    # Shoppex adapter (placeholder)
│   ├── middleware/
│   │   ├── error.middleware.js   # Central error handler + 404
│   │   ├── auth.middleware.js    # Auth placeholder (blocks all)
│   │   └── rate-limit.middleware.js
│   ├── db/
│   │   └── supabase.js           # Supabase client (service-role)
│   └── utils/
│       ├── logger.js             # Pino structured logger
│       └── idempotency.js        # Webhook deduplication
├── supabase/
│   └── schema.sql                # Full database schema + RPC
├── tests/
│   └── backend.test.js           # Vitest test suite
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
├── vitest.config.js
├── WHOP_WEBHOOK_EVENTS.md
├── SHOPPEX_WEBHOOK.md
└── README.md
```

---

## License

UNLICENSED — Private project.
