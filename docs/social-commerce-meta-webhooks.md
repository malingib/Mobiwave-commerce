# Meta webhook ingress

The shared Meta callback is `/api/webhooks/meta`. Configure the same callback URL
for the WhatsApp Cloud API and Instagram Messaging products in the Meta app.

## Required server environment

- `META_APP_SECRET`: Meta app secret used to validate `X-Hub-Signature-256`.
- `META_WEBHOOK_VERIFY_TOKEN`: high-entropy token entered in Meta's webhook setup.

Neither value belongs in browser-visible environment variables. Do not store either
value in PostgreSQL or log them.

## Supported ingress behavior

- GET performs Meta's `hub.mode=subscribe` verification using a constant-time token comparison.
- POST validates the HMAC-SHA256 signature against the exact raw body before parsing JSON.
- WhatsApp Business Account message/status changes and Instagram Messaging events are
  normalized into independently deduplicated webhook events.
- Events are queued only for a connected channel whose provider account ID matches
  the Meta entry ID. Unknown account IDs are acknowledged but counted as unmatched.
- The webhook endpoint does not send replies or create customer identities. A separate
  authenticated worker will process the durable event queue in the next phase.

Payloads are limited to 1 MiB. Meta should be configured to retry failed 5xx responses.
