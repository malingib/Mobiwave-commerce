-- Meta onboarding and encrypted provider credential vault.
-- Access tokens are encrypted with a server-side 32-byte key; only ciphertext is stored.
-- OAuth state is hashed, one-time, short-lived and bound to a store member.

CREATE TABLE channel_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_type text NOT NULL DEFAULT 'bearer',
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_validated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  UNIQUE (store_id, connection_id),
  FOREIGN KEY (store_id, connection_id)
    REFERENCES channel_connections(store_id, id) ON DELETE CASCADE
);

ALTER TABLE channel_connections
  ALTER COLUMN credential_ref TYPE uuid
  USING NULLIF(credential_ref, '')::uuid;

ALTER TABLE channel_connections
  ADD CONSTRAINT channel_connections_credential_ref_fk
  FOREIGN KEY (store_id, credential_ref)
  REFERENCES channel_credentials(store_id, id)
  ON DELETE SET NULL (credential_ref);

CREATE TABLE channel_oauth_states (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  ownership_mode text NOT NULL CHECK (ownership_mode IN ('merchant_owned', 'mobiwave_managed')),
  asset_owner_type text NOT NULL CHECK (asset_owner_type IN ('merchant', 'mobiwave')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, user_id)
    REFERENCES store_memberships(store_id, user_id) ON DELETE CASCADE
);
CREATE INDEX channel_oauth_states_expiry_idx
  ON channel_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE channel_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_credentials_service_access ON channel_credentials
  FOR ALL
  USING (
    current_setting('app.channel_oauth', true) = 'true'
    OR current_setting('app.channel_worker', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.channel_oauth', true) = 'true'
    OR current_setting('app.channel_worker', true) = 'true'
  );

ALTER TABLE channel_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_oauth_states_service_access ON channel_oauth_states
  FOR ALL
  USING (current_setting('app.channel_oauth', true) = 'true')
  WITH CHECK (current_setting('app.channel_oauth', true) = 'true');

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_credentials, channel_oauth_states TO commerce_runtime;

COMMENT ON TABLE channel_credentials IS
  'Server-only encrypted provider credentials. token_ciphertext is AES-256-GCM ciphertext; the encryption key exists only in server runtime secrets.';
COMMENT ON TABLE channel_oauth_states IS
  'One-time, hashed OAuth transaction state bound to a store membership; never exposed after consumption.';
