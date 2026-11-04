-- Configurable subscription catalogue and replay-safe M-Pesa subscription collections.
CREATE TABLE IF NOT EXISTS commerce_plans (
  code text PRIMARY KEY CHECK (code IN ('free', 'growth', 'pro', 'business')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  billing_interval text NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'yearly')),
  is_active boolean NOT NULL DEFAULT true,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE commerce_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_plans_public_active_read ON commerce_plans;
CREATE POLICY commerce_plans_public_active_read ON commerce_plans FOR SELECT
  USING (is_active = true);
DROP POLICY IF EXISTS commerce_plans_admin_manage ON commerce_plans;
CREATE POLICY commerce_plans_admin_manage ON commerce_plans FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');

INSERT INTO commerce_plans (code, name, description, amount_minor, currency, billing_interval, is_active, limits, features)
VALUES
  ('free', 'Free', 'Start selling with the essentials.', 0, 'KES', 'monthly', true, '{"maxDomains":0}'::jsonb,
   '["MobiWave store address","Product catalogue and checkout","Order management","Manual and cash-on-delivery payments"]'::jsonb),
  ('growth', 'Growth', 'For businesses building repeat sales.', NULL, 'KES', 'monthly', true, '{}'::jsonb,
   '["Everything in Free","Custom domain connection","Customer notifications","More store insights"]'::jsonb),
  ('pro', 'Pro', 'For growing teams and higher order volume.', NULL, 'KES', 'monthly', true, '{}'::jsonb,
   '["Everything in Growth","Advanced reports","More staff access","Priority support"]'::jsonb),
  ('business', 'Business', 'For established businesses with operational needs.', NULL, 'KES', 'monthly', true, '{}'::jsonb,
   '["Everything in Pro","Advanced controls","Integration support","Dedicated onboarding"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce_plans TO commerce_runtime;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_store_id_id_unique ON subscriptions(store_id, id);

CREATE TABLE IF NOT EXISTS subscription_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  plan_code text NOT NULL REFERENCES commerce_plans(code),
  provider text NOT NULL DEFAULT 'mpesa' CHECK (provider = 'mpesa'),
  status payment_status NOT NULL DEFAULT 'pending',
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  customer_phone text NOT NULL,
  checkout_request_id text,
  merchant_request_id text,
  provider_reference text,
  idempotency_key text NOT NULL,
  idempotency_hash text NOT NULL,
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, subscription_id) REFERENCES subscriptions(store_id, id) ON DELETE CASCADE,
  UNIQUE (store_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_attempts_checkout_unique
  ON subscription_payment_attempts(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_attempts_receipt_unique
  ON subscription_payment_attempts(provider_reference) WHERE provider_reference IS NOT NULL;
DROP INDEX IF EXISTS subscription_payment_attempts_one_pending;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_attempts_one_open
  ON subscription_payment_attempts(store_id) WHERE status IN ('pending', 'review_required');
CREATE INDEX IF NOT EXISTS subscription_payment_attempts_store_recent
  ON subscription_payment_attempts(store_id, created_at DESC);

ALTER TABLE subscription_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payment_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payment_attempts_member_access ON subscription_payment_attempts;
CREATE POLICY subscription_payment_attempts_member_access ON subscription_payment_attempts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = subscription_payment_attempts.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id = subscription_payment_attempts.store_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role = 'owner'
  ));
DROP POLICY IF EXISTS subscription_payment_attempts_callback_access ON subscription_payment_attempts;
CREATE POLICY subscription_payment_attempts_callback_access ON subscription_payment_attempts FOR ALL
  USING (current_setting('app.mpesa_callback', true) = 'true')
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true');
DROP POLICY IF EXISTS subscription_payment_attempts_admin_read ON subscription_payment_attempts;
CREATE POLICY subscription_payment_attempts_admin_read ON subscription_payment_attempts FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_payment_attempts TO commerce_runtime;

-- One receipt namespace across merchant order payments and subscription payments.
CREATE TABLE IF NOT EXISTS mpesa_receipt_claims (
  receipt_number text PRIMARY KEY,
  payment_type text NOT NULL CHECK (payment_type IN ('order', 'subscription')),
  payment_attempt_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mpesa_receipt_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_receipt_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpesa_receipt_claims_callback_access ON mpesa_receipt_claims;
CREATE POLICY mpesa_receipt_claims_callback_access ON mpesa_receipt_claims FOR ALL
  USING (current_setting('app.mpesa_callback', true) = 'true')
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true');
DROP POLICY IF EXISTS mpesa_receipt_claims_admin_read ON mpesa_receipt_claims;
CREATE POLICY mpesa_receipt_claims_admin_read ON mpesa_receipt_claims FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
GRANT SELECT, INSERT, UPDATE, DELETE ON mpesa_receipt_claims TO commerce_runtime;

DROP POLICY IF EXISTS subscriptions_mpesa_callback_access ON subscriptions;
CREATE POLICY subscriptions_mpesa_callback_access ON subscriptions FOR ALL
  USING (current_setting('app.mpesa_callback', true) = 'true')
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true');

DROP POLICY IF EXISTS mpesa_configurations_platform_subscription_read ON mpesa_configurations;
CREATE POLICY mpesa_configurations_platform_subscription_read ON mpesa_configurations FOR SELECT
  USING (
    scope_type = 'platform'
    AND enabled = true
    AND current_setting('app.subscription_payment', true) = 'true'
  );
