-- Durable SMS outbox with retry/lease support.
ALTER TABLE message_events
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_status_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_status_check
  CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS message_events_due_idx
  ON message_events(status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'processing');

DROP POLICY IF EXISTS message_events_worker_access ON message_events;
CREATE POLICY message_events_worker_access ON message_events FOR ALL
  USING (current_setting('app.message_worker', true) = 'true')
  WITH CHECK (current_setting('app.message_worker', true) = 'true');

DROP POLICY IF EXISTS message_events_checkout_insert ON message_events;
CREATE POLICY message_events_checkout_insert ON message_events FOR INSERT
  WITH CHECK (current_setting('app.checkout', true) = 'true' AND channel = 'sms');

DROP POLICY IF EXISTS message_events_callback_insert ON message_events;
CREATE POLICY message_events_callback_insert ON message_events FOR INSERT
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true' AND channel = 'sms');

GRANT SELECT, INSERT, UPDATE, DELETE ON message_events TO commerce_runtime;
