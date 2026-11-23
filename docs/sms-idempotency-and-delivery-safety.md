# SMS idempotency and delivery safety

- Enqueue uses (store_id, dedupe_key) and compares order, recipient, template, and JSON payload. A reused key with changed immutable content fails closed.
- Provider request keys are stable SHA-256 digests of store ID and event dedupe key, consistent across retries.
- Each claim has a random lease/fencing token. State updates require the same token.
- HTTP 429 is a definite rate-limit rejection and may retry using Retry-After or bounded exponential backoff with jitter.
- Explicit 4xx rejection is terminal.
- Network errors, timeouts, HTTP 408, HTTP 5xx, unreadable success responses, and DB failure after provider acceptance are ambiguous.
- Ambiguous outcomes transition to delivery_unknown and are excluded from automatic retry.
- Expired processing leases become delivery_unknown, never queued. A late response from the same lease can still record sent.
- The provider receives Idempotency-Key, but its server-side deduplication contract remains unconfirmed. Do not claim exactly-once delivery.
- Wallet integration must reserve before provider submission. Release only after a definite rejection; retain funds for ambiguous outcomes pending reconciliation.
