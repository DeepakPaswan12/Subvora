# Whop Webhook Events — Configuration Reference

## Overview

This document explains where to find and configure the exact Whop webhook
event names and signature verification behavior for the Subvora backend.

## Where to find the official event list

1. **Whop Developer Dashboard** → <https://whop.com/dashboard> → Developer Settings → Webhooks
2. **Whop Docs** → <https://dev.whop.com/> (see Webhooks section)

When you create or edit a webhook endpoint in the dashboard, Whop shows a list
of all available event types you can subscribe to.

## Currently configured events

The backend handles these events (defined in `src/services/whop.service.js` →
`SUPPORTED_EVENTS`):

| Event type                 | Handler                         |
| -------------------------- | ------------------------------- |
| `payment.succeeded`        | Creates order, reserves + delivers inventory |
| `payment.failed`           | Logs failure — no fulfillment   |
| `membership.activated`     | Creates order + fulfillment     |
| `membership.deactivated`   | Logs deactivation               |

### How to add a new event

1. Add the event string to the `SUPPORTED_EVENTS` map in
   `src/services/whop.service.js`.
2. Create a handler function in `src/controllers/whop.controller.js` →
   `routeEvent()` switch statement.
3. Subscribe to the event in your Whop Dashboard webhook configuration.

## Signature verification

Whop uses the **Standard Webhooks** specification:

- **Headers sent by Whop:**
  - `webhook-id` — unique event identifier
  - `webhook-timestamp` — UNIX seconds
  - `webhook-signature` — `v1,<base64(HMAC-SHA256)>`

- **Signing input:**
  ```
  ${webhook-id}.${webhook-timestamp}.${rawBody}
  ```

- **Key derivation:**
  The secret from the dashboard (e.g. `ws_0123456789abcdef...`) has a `ws_` prefix.
  The HMAC key is the **raw secret string itself** used as UTF-8 bytes.
  Do NOT strip the prefix. Do NOT base64-decode it.

- **Replay protection:**
  The backend rejects events where `|now - webhook-timestamp| > 300 seconds`.

### Where the secret comes from

1. Go to **Whop Dashboard → Developer → Webhooks**.
2. Create or select your webhook endpoint.
3. Copy the signing secret (starts with `ws_`).
4. Set it as `WHOP_WEBHOOK_SECRET` in your `.env` / Render env vars.

## Additional events you may want

Depending on your business logic, consider subscribing to:

- `payment.created` / `payment.pending` / `payment.requires_action`
- `membership.trial_ending_soon` / `membership.cancel_at_period_end_changed`
- `invoice.paid` / `invoice.past_due` / `invoice.voided`
- `refund.created` / `refund.updated`
- `dispute.created` / `dispute.updated`

Always verify the exact event name in the Whop dashboard before adding it.
