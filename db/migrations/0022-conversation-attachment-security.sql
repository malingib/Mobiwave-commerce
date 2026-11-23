-- Secure private media metadata and quarantine lifecycle.
ALTER TABLE conversation_attachments
  ADD COLUMN detected_mime_type text,
  ADD COLUMN sha256 char(64),
  ADD COLUMN scan_status text NOT NULL DEFAULT 'quarantined',
  ADD COLUMN scanned_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conversation_attachments
  ADD CONSTRAINT conversation_attachments_scan_status_check
  CHECK (scan_status IN ('pending','quarantined','available','rejected','deleted'));
ALTER TABLE conversation_attachments
  ADD CONSTRAINT conversation_attachments_sha256_check
  CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX conversation_attachments_storage_key_uq ON conversation_attachments(storage_key);
CREATE INDEX conversation_attachments_scan_queue_idx ON conversation_attachments(scan_status,created_at) WHERE scan_status IN ('pending','quarantined');
COMMENT ON COLUMN conversation_attachments.scan_status IS 'Only available attachments can be downloaded or reused. Missing scanner configuration leaves uploads quarantined.';
COMMENT ON COLUMN conversation_attachments.sha256 IS 'SHA-256 of the verified object bytes, computed before storage.';

-- The authenticated channel worker must be able to persist inbound media metadata.
-- This does not grant direct merchant access; the worker flag is transaction-local.
CREATE POLICY conversation_attachments_worker_access ON conversation_attachments
  FOR ALL
  USING (current_setting('app.channel_worker', true) = 'true')
  WITH CHECK (current_setting('app.channel_worker', true) = 'true');
