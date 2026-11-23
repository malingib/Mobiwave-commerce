-- Idempotent M-Pesa wallet top-ups and a single receipt namespace.
ALTER TABLE mpesa_receipt_claims DROP CONSTRAINT IF EXISTS mpesa_receipt_claims_payment_type_check;
ALTER TABLE mpesa_receipt_claims ADD CONSTRAINT mpesa_receipt_claims_payment_type_check
  CHECK (payment_type IN ('order','subscription','wallet_topup'));

CREATE TABLE IF NOT EXISTS wallet_topup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mpesa' CHECK (provider='mpesa'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','review_required')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 100 AND amount_minor % 100 = 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency='KES'),
  customer_phone text NOT NULL,
  checkout_request_id text,
  merchant_request_id text,
  provider_reference text,
  idempotency_key text NOT NULL,
  idempotency_hash text NOT NULL,
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_topup_attempts_checkout_unique
  ON wallet_topup_attempts(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_topup_attempts_receipt_unique
  ON wallet_topup_attempts(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_topup_attempts_one_open
  ON wallet_topup_attempts(store_id) WHERE status IN ('pending','review_required');
CREATE INDEX IF NOT EXISTS wallet_topup_attempts_store_recent
  ON wallet_topup_attempts(store_id,created_at DESC);

ALTER TABLE wallet_topup_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_topup_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_topup_attempts_owner_read ON wallet_topup_attempts;
CREATE POLICY wallet_topup_attempts_owner_read ON wallet_topup_attempts FOR SELECT
  USING (current_setting('app.admin',true)='true' OR EXISTS (
    SELECT 1 FROM store_memberships m WHERE m.store_id=wallet_topup_attempts.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
DROP POLICY IF EXISTS wallet_topup_attempts_initiation ON wallet_topup_attempts;
CREATE POLICY wallet_topup_attempts_initiation ON wallet_topup_attempts FOR INSERT
  WITH CHECK (current_setting('app.wallet_topup',true)='true' AND EXISTS (
    SELECT 1 FROM store_memberships m WHERE m.store_id=wallet_topup_attempts.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
DROP POLICY IF EXISTS wallet_topup_attempts_initiation_update ON wallet_topup_attempts;
CREATE POLICY wallet_topup_attempts_initiation_update ON wallet_topup_attempts FOR UPDATE
  USING (current_setting('app.wallet_topup',true)='true' AND EXISTS (
    SELECT 1 FROM store_memberships m WHERE m.store_id=wallet_topup_attempts.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'))
  WITH CHECK (current_setting('app.wallet_topup',true)='true' AND EXISTS (
    SELECT 1 FROM store_memberships m WHERE m.store_id=wallet_topup_attempts.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
DROP POLICY IF EXISTS wallet_topup_attempts_callback ON wallet_topup_attempts;
CREATE POLICY wallet_topup_attempts_callback ON wallet_topup_attempts FOR ALL
  USING (current_setting('app.mpesa_callback',true)='true')
  WITH CHECK (current_setting('app.mpesa_callback',true)='true');
DROP POLICY IF EXISTS wallet_topup_attempts_admin_manage ON wallet_topup_attempts;
CREATE POLICY wallet_topup_attempts_admin_manage ON wallet_topup_attempts FOR ALL
  USING (current_setting('app.admin',true)='true')
  WITH CHECK (current_setting('app.admin',true)='true');
GRANT SELECT,INSERT,UPDATE ON wallet_topup_attempts TO commerce_runtime;
REVOKE DELETE ON wallet_topup_attempts FROM commerce_runtime;

CREATE OR REPLACE FUNCTION enforce_wallet_topup_attempt_transition()
RETURNS trigger LANGUAGE plpgsql AS $wallet_topup_fn$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'wallet_topup_attempts_cannot_be_deleted'; END IF;
  IF OLD.store_id IS DISTINCT FROM NEW.store_id OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.customer_phone IS DISTINCT FROM NEW.customer_phone OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.idempotency_hash IS DISTINCT FROM NEW.idempotency_hash OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'wallet_topup_attempt_identity_is_immutable';
  END IF;
  IF OLD.checkout_request_id IS NOT NULL AND OLD.checkout_request_id IS DISTINCT FROM NEW.checkout_request_id THEN
    RAISE EXCEPTION 'wallet_topup_checkout_request_is_immutable';
  END IF;
  IF OLD.merchant_request_id IS NOT NULL AND OLD.merchant_request_id IS DISTINCT FROM NEW.merchant_request_id THEN
    RAISE EXCEPTION 'wallet_topup_merchant_request_is_immutable';
  END IF;
  IF OLD.provider_reference IS NOT NULL AND OLD.provider_reference IS DISTINCT FROM NEW.provider_reference THEN
    RAISE EXCEPTION 'wallet_topup_receipt_is_immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status='pending' AND NEW.status IN ('paid','failed','review_required'))
    OR (OLD.status='failed' AND NEW.status='review_required' AND current_setting('app.mpesa_callback',true)='true')
    OR (OLD.status='review_required' AND NEW.status IN ('paid','failed') AND current_setting('app.admin',true)='true')
  ) THEN
    RAISE EXCEPTION 'invalid_wallet_topup_status_transition';
  END IF;
  IF NEW.provider_reference IS NOT NULL AND NEW.status<>'paid' THEN
    RAISE EXCEPTION 'wallet_topup_receipt_requires_paid_status';
  END IF;
  IF OLD.checkout_request_id IS NULL AND NEW.checkout_request_id IS NOT NULL
    AND current_setting('app.wallet_topup',true)<>'true' THEN
    RAISE EXCEPTION 'wallet_topup_checkout_id_requires_initiation_capability';
  END IF;
  RETURN NEW;
END;
$wallet_topup_fn$;
DROP TRIGGER IF EXISTS wallet_topup_attempt_transition ON wallet_topup_attempts;
CREATE TRIGGER wallet_topup_attempt_transition BEFORE UPDATE OR DELETE ON wallet_topup_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_wallet_topup_attempt_transition();

-- The same encrypted platform Daraja configuration can be used by the
-- authenticated wallet-top-up initiation path; no merchant receives secrets.
DROP POLICY IF EXISTS mpesa_configurations_platform_wallet_topup_read ON mpesa_configurations;
CREATE POLICY mpesa_configurations_platform_wallet_topup_read ON mpesa_configurations FOR SELECT
  USING (scope_type='platform' AND enabled=true AND current_setting('app.wallet_topup',true)='true');

COMMENT ON TABLE wallet_topup_attempts IS 'Idempotent M-Pesa wallet top-up attempts. Credits are posted only by a verified Daraja callback.';
