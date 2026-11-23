-- Safe SMS delivery idempotency and ambiguous-outcome handling.
ALTER TABLE message_events
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_unknown_at timestamptz;
ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_status_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_status_check
  CHECK (status IN ('queued','processing','sent','delivered','failed','cancelled','delivery_unknown'));
CREATE INDEX IF NOT EXISTS message_events_processing_lease_idx ON message_events(locked_at) WHERE status='processing';
CREATE INDEX IF NOT EXISTS message_events_delivery_unknown_idx ON message_events(store_id,delivery_unknown_at DESC) WHERE status='delivery_unknown';
COMMENT ON COLUMN message_events.lease_token IS 'Fencing token for the claimed worker attempt; stale workers cannot overwrite newer state.';
COMMENT ON COLUMN message_events.delivery_unknown_at IS 'Ambiguous provider outcome; excluded from automatic retries until reconciled.';
