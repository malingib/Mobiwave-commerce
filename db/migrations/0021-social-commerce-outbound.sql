-- Outbound messaging safety and least-privilege worker access.
-- The internal worker authenticates before setting app.channel_worker=true.

ALTER TABLE message_outbox
  ADD COLUMN request_hash char(64);

UPDATE message_outbox SET request_hash = repeat('0', 64) WHERE request_hash IS NULL;

ALTER TABLE message_outbox
  ALTER COLUMN request_hash SET NOT NULL;

ALTER TABLE message_outbox
  ADD CONSTRAINT message_outbox_request_hash_check
  CHECK (request_hash ~ '^[a-f0-9]{64}$');

CREATE INDEX message_outbox_lease_idx
  ON message_outbox(status, locked_at)
  WHERE status = 'processing';

-- The webhook ingress/worker previously had no explicit RLS path to resolve
-- channel connections or persist inbound identities, conversations and messages.
-- Keep provider connection access read-only; worker writes are limited to
-- normalized messaging tables and the durable outbox.
CREATE POLICY channel_identities_worker_access ON channel_identities
  FOR ALL
  USING (current_setting('app.channel_worker', true) = 'true')
  WITH CHECK (current_setting('app.channel_worker', true) = 'true');

CREATE POLICY conversations_worker_access ON conversations
  FOR ALL
  USING (current_setting('app.channel_worker', true) = 'true')
  WITH CHECK (current_setting('app.channel_worker', true) = 'true');

CREATE POLICY conversation_messages_worker_access ON conversation_messages
  FOR ALL
  USING (current_setting('app.channel_worker', true) = 'true')
  WITH CHECK (current_setting('app.channel_worker', true) = 'true');

COMMENT ON COLUMN message_outbox.request_hash IS
  'SHA-256 of the canonical outbound request; rejects reuse of an idempotency key with different content.';
