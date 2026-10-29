-- Commerce hardening: idempotent checkout fingerprints, payment review states and durable rate limits.
-- Apply once through the normal migration process before deploying the matching application code.

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'review_required';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_hash text;

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_rate_limits_updated_idx ON api_rate_limits(updated_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON api_rate_limits TO commerce_runtime;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_mpesa_receipt_unique
  ON payment_attempts(provider_reference)
  WHERE provider = 'mpesa' AND provider_reference IS NOT NULL;

-- Schedule: DELETE FROM api_rate_limits WHERE updated_at < now() - interval '2 days';

-- The callback path may only move orders into the explicit reconciliation state as well.
DROP POLICY IF EXISTS orders_mpesa_callback_update ON orders;
CREATE POLICY orders_mpesa_callback_update ON orders FOR UPDATE
  USING (current_setting('app.mpesa_callback', true) = 'true')
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true'
    AND payment_status IN ('paid', 'failed', 'pending', 'unpaid', 'review_required'));
