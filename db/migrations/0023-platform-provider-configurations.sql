-- Platform-owned application provider configuration.
-- Secret values are AES-256-GCM ciphertext; the root key remains in deployment secrets.
CREATE TABLE platform_provider_configurations (
  provider text PRIMARY KEY CHECK (provider IN ('meta','mobiwave_sms','r2','media_scanner')),
  config_ciphertext jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured','configured','verified','error')),
  last_verified_at timestamptz,
  last_error_code text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(config_ciphertext) = 'object')
);
ALTER TABLE platform_provider_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_provider_configurations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_provider_configurations_admin_read
  ON platform_provider_configurations FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY platform_provider_configurations_admin_write
  ON platform_provider_configurations FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');
CREATE POLICY platform_provider_configurations_runtime_read
  ON platform_provider_configurations FOR SELECT
  USING (current_setting('app.provider_config_read', true) = 'true');
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_provider_configurations TO commerce_runtime;
COMMENT ON TABLE platform_provider_configurations IS
  'Platform-level application provider settings. Values are individually encrypted; never store DATABASE_URL, infrastructure bootstrap secrets, or the encryption root key here.';
