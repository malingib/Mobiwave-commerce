-- Social Commerce foundation: official channel connections, normalized identities,
-- conversations, messages and durable webhook/message processing records.
-- Provider secrets are deliberately NOT stored here. credential_ref points to a
-- server-side secret-manager entry; never put access tokens in this database.

CREATE TABLE channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'website')),
  ownership_mode text NOT NULL CHECK (ownership_mode IN ('merchant_owned', 'mobiwave_managed')),
  asset_owner_type text NOT NULL CHECK (asset_owner_type IN ('merchant', 'mobiwave')),
  provider_business_id text,
  provider_account_id text,
  provider_address_id text,
  display_name text,
  credential_ref text,
  granted_permissions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'reauthorization_required', 'disconnected', 'error')),
  connected_by uuid,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, connected_by)
    REFERENCES store_memberships(store_id, user_id) ON DELETE SET NULL (connected_by),
  CHECK ((ownership_mode = 'merchant_owned' AND asset_owner_type = 'merchant')
      OR (ownership_mode = 'mobiwave_managed' AND asset_owner_type = 'mobiwave')),
  CHECK (credential_ref IS NULL OR length(credential_ref) <= 512)
);
CREATE UNIQUE INDEX channel_connections_provider_account_uq
  ON channel_connections(channel, provider_account_id)
  WHERE provider_account_id IS NOT NULL AND status <> 'disconnected';
CREATE INDEX channel_connections_store_idx
  ON channel_connections(store_id, channel, status);

CREATE TABLE channel_connection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('created', 'connected', 'reauthorized', 'permission_changed', 'disconnected', 'error', 'health_check')),
  actor_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, connection_id)
    REFERENCES channel_connections(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, actor_user_id)
    REFERENCES store_memberships(store_id, user_id) ON DELETE SET NULL (actor_user_id)
);
CREATE INDEX channel_connection_events_recent_idx
  ON channel_connection_events(store_id, connection_id, created_at DESC);

CREATE TABLE channel_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  FOREIGN KEY (store_id, connection_id)
    REFERENCES channel_connections(store_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX channel_webhook_provider_event_uq
  ON channel_webhook_events(connection_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX channel_webhook_due_idx
  ON channel_webhook_events(processing_status, next_attempt_at, received_at)
  WHERE processing_status IN ('received', 'failed', 'processing');

CREATE TABLE channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'website', 'email', 'sms')),
  external_user_id text NOT NULL,
  display_name text,
  phone_e164 text,
  email text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  UNIQUE (store_id, channel, external_user_id)
);
CREATE INDEX channel_identities_phone_idx ON channel_identities(store_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;
CREATE INDEX channel_identities_email_idx ON channel_identities(store_id, lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'website', 'email', 'sms')),
  external_thread_id text,
  subject text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'resolved', 'archived')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_message_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, connection_id)
    REFERENCES channel_connections(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, identity_id)
    REFERENCES channel_identities(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, assigned_to)
    REFERENCES store_memberships(store_id, user_id) ON DELETE SET NULL (assigned_to)
);
CREATE UNIQUE INDEX conversations_external_thread_uq
  ON conversations(connection_id, external_thread_id)
  WHERE external_thread_id IS NOT NULL;
CREATE INDEX conversations_inbox_idx
  ON conversations(store_id, status, last_message_at DESC NULLS LAST);
CREATE INDEX conversations_assignee_idx
  ON conversations(store_id, assigned_to, status, last_message_at DESC);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  message_type text NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'location', 'interactive', 'template', 'system', 'unsupported')),
  content text,
  provider_status text NOT NULL DEFAULT 'received'
    CHECK (provider_status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed', 'undeliverable')),
  provider_error_code text,
  reply_to_message_id uuid,
  sender_user_id uuid,
  provider_timestamp timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, connection_id)
    REFERENCES channel_connections(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, reply_to_message_id)
    REFERENCES conversation_messages(store_id, id) ON DELETE SET NULL (reply_to_message_id),
  FOREIGN KEY (store_id, sender_user_id)
    REFERENCES store_memberships(store_id, user_id) ON DELETE SET NULL (sender_user_id),
  UNIQUE (store_id, id)
);
CREATE UNIQUE INDEX conversation_messages_provider_id_uq
  ON conversation_messages(connection_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX conversation_messages_timeline_idx
  ON conversation_messages(store_id, conversation_id, created_at DESC);

CREATE TABLE conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  message_id uuid NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  file_name text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  provider_media_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, message_id)
    REFERENCES conversation_messages(store_id, id) ON DELETE CASCADE,
  UNIQUE (store_id, id)
);
CREATE INDEX conversation_attachments_message_idx
  ON conversation_attachments(store_id, message_id);

CREATE TABLE conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, author_user_id)
    REFERENCES store_memberships(store_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX conversation_notes_recent_idx
  ON conversation_notes(store_id, conversation_id, created_at DESC);

CREATE TABLE message_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, connection_id)
    REFERENCES channel_connections(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, message_id)
    REFERENCES conversation_messages(store_id, id) ON DELETE CASCADE,
  UNIQUE (store_id, idempotency_key)
);
CREATE INDEX message_outbox_due_idx
  ON message_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'processing');

-- All new merchant data is protected by forced RLS. The channel worker receives
-- a narrow transaction-local policy flag after authenticating its internal token.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'channel_connections', 'channel_connection_events', 'channel_webhook_events',
    'channel_identities', 'conversations', 'conversation_messages',
    'conversation_attachments', 'conversation_notes', 'message_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE POLICY channel_connections_member_access ON channel_connections
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = channel_connections.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
CREATE POLICY channel_connections_manager_write ON channel_connections
  FOR ALL USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = channel_connections.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'manager')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = channel_connections.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'manager')
  ));

CREATE POLICY channel_connection_events_member_read ON channel_connection_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = channel_connection_events.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
CREATE POLICY channel_connection_events_worker_write ON channel_connection_events
  FOR INSERT WITH CHECK (current_setting('app.channel_worker', true) = 'true');

CREATE POLICY channel_webhook_events_worker_access ON channel_webhook_events
  FOR ALL USING (current_setting('app.channel_worker', true) = 'true')
  WITH CHECK (current_setting('app.channel_worker', true) = 'true');

CREATE POLICY channel_identities_member_access ON channel_identities
  FOR ALL USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = channel_identities.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = channel_identities.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));

CREATE POLICY conversations_member_access ON conversations
  FOR ALL USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversations.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversations.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));

CREATE POLICY conversation_messages_member_access ON conversation_messages
  FOR ALL USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversation_messages.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversation_messages.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
CREATE POLICY conversation_attachments_member_access ON conversation_attachments
  FOR ALL USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversation_attachments.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversation_attachments.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
CREATE POLICY conversation_notes_member_access ON conversation_notes
  FOR ALL USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversation_notes.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = conversation_notes.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
CREATE POLICY message_outbox_worker_access ON message_outbox
  FOR ALL USING (current_setting('app.channel_worker', true) = 'true')
  WITH CHECK (current_setting('app.channel_worker', true) = 'true');

GRANT SELECT, INSERT, UPDATE, DELETE ON
  channel_connections, channel_connection_events, channel_webhook_events,
  channel_identities, conversations, conversation_messages,
  conversation_attachments, conversation_notes, message_outbox
TO commerce_runtime;

COMMENT ON TABLE channel_connections IS
  'Official provider channel connections. credential_ref points to a server-side secret manager; raw access tokens must never be stored here.';
COMMENT ON TABLE channel_webhook_events IS
  'Raw provider webhook event inbox. Payload is retained for dedupe, replay and audit; access is worker-only.';
COMMENT ON TABLE message_outbox IS
  'Durable outbound channel message queue. Provider sends must use idempotency_key and update delivery state from webhooks.';
