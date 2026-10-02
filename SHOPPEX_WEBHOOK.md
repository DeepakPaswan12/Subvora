# Shoppex Dynamic Webhook — Integration Reference

## Endpoint

```
POST /webhooks/shoppex
```

Full URL (after Render deploy):
```
https://<your-render-service>.onrender.com/webhooks/shoppex
```

## Required secret

Set the `SHOPPEX_WEBHOOK_SECRET` environment variable to the signing secret
provided by Shoppex. This is used in `src/services/shoppex.service.js` →
`verifyShoppexSignature()`.

## Request schema

> ⚠️ **UNKNOWN** — The exact request payload format has not been confirmed
> from official Shoppex documentation.

The current placeholder in `src/services/shoppex.service.js` →
`parseShoppexPayload()` expects these fields (best guesses):

```jsonc
// PLACEHOLDER — update when official schema is available
{
  "order_id": "string",       // or "transaction_id"
  "product_id": "string",     // or "item_id"
  "customer_email": "string", // or "email"
  "quantity": 1
}
```

### What to do when you get the real schema

1. Create a Zod schema in `src/services/shoppex.service.js`.
2. Update `parseShoppexPayload()` to use the real field names.
3. Update `verifyShoppexSignature()` with the real algorithm.

## Response schema

> ⚠️ **UNKNOWN** — The exact response format Shoppex expects has not been
> confirmed from official documentation.

The current placeholder returns:

```jsonc
// PLACEHOLDER — update when official schema is available
{
  "status": "success",
  "content": "<entitlement value>",
  "order_id": "<subvora order UUID>"
}
```

Error response placeholder:

```jsonc
{
  "status": "error",
  "message": "<error description>"
}
```

### What to do when you get the real response schema

1. Update `formatShoppexResponse()` in `src/services/shoppex.service.js`.
2. Update `formatShoppexErrorResponse()` in the same file.

## Signature verification

> ⚠️ **UNKNOWN** — The verification algorithm is a placeholder.

Current placeholder assumes HMAC-SHA256 of the raw body with the webhook
secret, but the actual header name and algorithm are unknown.

### What to do

1. Get the real signing algorithm from Shoppex documentation.
2. Get the real signature header name (e.g. `x-shoppex-signature`).
3. Update `verifyShoppexSignature()` in `src/services/shoppex.service.js`.
4. Enable the 401 rejection in `src/controllers/shoppex.controller.js`
   (currently commented out to allow integration testing).

## Testing instructions

### Local testing with curl

```bash
curl -X POST http://localhost:3000/webhooks/shoppex \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "test-order-123",
    "product_id": "your-shoppex-product-id",
    "customer_email": "buyer@example.com",
    "quantity": 1
  }'
```

### Before production

- [ ] Obtain and apply the official Shoppex Dynamic Webhook documentation.
- [ ] Implement real signature verification.
- [ ] Update request/response schemas.
- [ ] Enable signature rejection (uncomment the 401 return).
- [ ] Test with a real Shoppex sandbox/test payment.
- [ ] Verify idempotency works correctly with Shoppex's event ID format.

## Files to modify

| File | What to update |
| ---- | -------------- |
| `src/services/shoppex.service.js` | Signature verification, payload parsing, response formatting |
| `src/controllers/shoppex.controller.js` | Enable signature rejection, adjust error handling |
| `.env` | Set `SHOPPEX_WEBHOOK_SECRET` |
