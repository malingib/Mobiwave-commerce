-- Scoped M-Pesa settings: platform defaults and per-merchant overrides.
-- Credential fields are AES-256-GCM ciphertext produced by the application.
CREATE TABLE IF NOT EXISTS mpesa_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('platform', 'store')),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  consumer_key_ciphertext text NOT NULL,
  consumer_secret_ciphertext text NOT NULL,
  shortcode text NOT NULL,
  passkey_ciphertext text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  transaction_type text NOT NULL DEFAULT 'CustomerPayBillOnline' CHECK (transaction_type IN ('CustomerPayBillOnline', 'CustomerBuyGoodsOnline')),
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'platform' AND store_id IS NULL) OR (scope_type = 'store' AND store_id IS NOT NULL)),
  UNIQUE (scope_type, store_id)
);
ALTER TABLE mpesa_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_configurations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpesa_configurations_platform_admin ON mpesa_configurations;
CREATE POLICY mpesa_configurations_platform_admin ON mpesa_configurations
  USING (scope_type = 'platform' AND current_setting('app.admin', true) = 'true')
  WITH CHECK (scope_type = 'platform' AND current_setting('app.admin', true) = 'true');
DROP POLICY IF EXISTS mpesa_configurations_store_member ON mpesa_configurations;
CREATE POLICY mpesa_configurations_store_member ON mpesa_configurations
  USING (scope_type = 'store' AND EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = mpesa_configurations.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'manager')
  ))
  WITH CHECK (scope_type = 'store' AND EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = mpesa_configurations.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner', 'manager')
  ));
GRANT SELECT, INSERT, UPDATE, DELETE ON mpesa_configurations TO commerce_runtime;

-- PostgreSQL UNIQUE constraints treat NULLs as distinct; enforce one platform row explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS mpesa_configurations_single_platform
  ON mpesa_configurations(scope_type) WHERE scope_type = 'platform';
