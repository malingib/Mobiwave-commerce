-- Store onboarding, hybrid launch approval and hardened custom-domain lifecycle.
-- Apply only through the numbered migration process. Never run against production manually.

CREATE TABLE store_onboarding (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  business_category text NOT NULL DEFAULT 'general_retail'
    CHECK (business_category IN ('general_retail','food_beverage','beauty','fashion','electronics','home_living','services','digital_goods','regulated','other')),
  business_description text NOT NULL DEFAULT '',
  website_url text,
  launch_status text NOT NULL DEFAULT 'incomplete'
    CHECK (launch_status IN ('incomplete','pending_review','auto_approved','approved','rejected')),
  risk_flags text[] NOT NULL DEFAULT '{}',
  submitted_at timestamptz,
  auto_approved_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (website_url IS NULL OR (website_url ~ '^https://[^[:space:]/]+([/?#].*)?$' AND length(website_url) <= 2048)),
  CHECK (review_note IS NULL OR length(review_note) <= 2000)
);
INSERT INTO store_onboarding (store_id)
SELECT id FROM stores
ON CONFLICT (store_id) DO NOTHING;

CREATE INDEX store_onboarding_review_queue_idx
  ON store_onboarding(submitted_at DESC)
  WHERE launch_status = 'pending_review';

ALTER TABLE store_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY store_onboarding_member_read ON store_onboarding
  FOR SELECT USING (
    current_setting('app.admin', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM store_memberships m
      WHERE m.store_id = store_onboarding.store_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND m.role IN ('owner','manager')
    )
  );
CREATE POLICY store_onboarding_member_write ON store_onboarding
  FOR ALL USING (
    current_setting('app.admin', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM store_memberships m
      WHERE m.store_id = store_onboarding.store_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND m.role = 'owner'
    )
  )
  WITH CHECK (
    current_setting('app.admin', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM store_memberships m
      WHERE m.store_id = store_onboarding.store_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND m.role = 'owner'
    )
  );
GRANT SELECT, INSERT, UPDATE ON store_onboarding TO commerce_runtime;

-- Never retain plaintext DNS verification secrets. Existing values are hashed
-- before the plaintext column is dropped. New tokens are returned only once.
ALTER TABLE store_domains ADD COLUMN verification_token_hash text;
UPDATE store_domains
   SET verification_token_hash = encode(digest(verification_token, 'sha256'), 'hex')
 WHERE verification_token IS NOT NULL;
ALTER TABLE store_domains ALTER COLUMN verification_token_hash SET NOT NULL;
ALTER TABLE store_domains ALTER COLUMN verification_token DROP NOT NULL;
ALTER TABLE store_domains DROP COLUMN verification_token;

ALTER TABLE store_domains
  ADD COLUMN provider_status text NOT NULL DEFAULT 'pending'
    CHECK (provider_status IN ('pending','attached','error')),
  ADD COLUMN provider_domain_id text,
  ADD COLUMN dns_status text NOT NULL DEFAULT 'pending'
    CHECK (dns_status IN ('pending','ready','error')),
  ADD COLUMN tls_status text NOT NULL DEFAULT 'pending'
    CHECK (tls_status IN ('pending','ready','error')),
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN canonical_target text,
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN last_error text;
CREATE UNIQUE INDEX store_domains_one_primary_per_store
  ON store_domains(store_id) WHERE is_primary = true;
CREATE INDEX store_domains_provider_status_idx
  ON store_domains(provider_status, dns_status, tls_status);
