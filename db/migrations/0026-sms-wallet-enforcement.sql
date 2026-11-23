-- Per-store SMS billing configuration and immutable usage reservation ledger.
-- A missing/disabled configuration intentionally fails closed: no SMS is sent unpriced.
CREATE TABLE IF NOT EXISTS store_sms_billing_config (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  included_segments_per_month integer NOT NULL DEFAULT 0 CHECK (included_segments_per_month >= 0),
  unit_rate_minor bigint NOT NULL CHECK (unit_rate_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE TABLE IF NOT EXISTS store_sms_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES message_events(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  total_segments integer NOT NULL CHECK (total_segments > 0),
  included_segments integer NOT NULL CHECK (included_segments >= 0),
  billable_segments integer NOT NULL CHECK (billable_segments >= 0),
  unit_rate_minor bigint NOT NULL CHECK (unit_rate_minor >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  wallet_reservation_id uuid,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (store_id,event_id),
  CHECK (included_segments + billable_segments = total_segments),
  CHECK (amount_minor = billable_segments * unit_rate_minor)
);
CREATE INDEX IF NOT EXISTS store_sms_usage_period_idx
  ON store_sms_usage(store_id,period_start) WHERE status IN ('reserved','committed');
CREATE INDEX IF NOT EXISTS store_sms_usage_recent_idx ON store_sms_usage(store_id,created_at DESC);

ALTER TABLE store_sms_billing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_sms_billing_config FORCE ROW LEVEL SECURITY;
ALTER TABLE store_sms_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_sms_usage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_sms_billing_config_read ON store_sms_billing_config;
CREATE POLICY store_sms_billing_config_read ON store_sms_billing_config FOR SELECT
  USING (current_setting('app.admin',true)='true' OR current_setting('app.message_worker',true)='true'
    OR EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id=store_sms_billing_config.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid));
DROP POLICY IF EXISTS store_sms_billing_config_admin_write ON store_sms_billing_config;
CREATE POLICY store_sms_billing_config_admin_write ON store_sms_billing_config FOR ALL
  USING (current_setting('app.admin',true)='true')
  WITH CHECK (current_setting('app.admin',true)='true');

DROP POLICY IF EXISTS store_sms_usage_member_read ON store_sms_usage;
CREATE POLICY store_sms_usage_member_read ON store_sms_usage FOR SELECT
  USING (current_setting('app.admin',true)='true' OR current_setting('app.message_worker',true)='true'
    OR EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id=store_sms_usage.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid));
DROP POLICY IF EXISTS store_sms_usage_worker_write ON store_sms_usage;
CREATE POLICY store_sms_usage_worker_write ON store_sms_usage FOR ALL
  USING (current_setting('app.message_worker',true)='true' OR current_setting('app.admin',true)='true')
  WITH CHECK (current_setting('app.message_worker',true)='true' OR current_setting('app.admin',true)='true');

GRANT SELECT,INSERT,UPDATE ON store_sms_billing_config TO commerce_runtime;
GRANT SELECT,INSERT,UPDATE ON store_sms_usage TO commerce_runtime;
REVOKE DELETE ON store_sms_billing_config,store_sms_usage FROM commerce_runtime;

CREATE OR REPLACE FUNCTION enforce_store_sms_usage_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'store_sms_usage_cannot_be_deleted'; END IF;
  IF OLD.store_id IS DISTINCT FROM NEW.store_id OR OLD.event_id IS DISTINCT FROM NEW.event_id
    OR OLD.period_start IS DISTINCT FROM NEW.period_start OR OLD.total_segments IS DISTINCT FROM NEW.total_segments
    OR OLD.included_segments IS DISTINCT FROM NEW.included_segments OR OLD.billable_segments IS DISTINCT FROM NEW.billable_segments
    OR OLD.unit_rate_minor IS DISTINCT FROM NEW.unit_rate_minor OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor
    OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.wallet_reservation_id IS DISTINCT FROM NEW.wallet_reservation_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'store_sms_usage_identity_is_immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status
    AND NOT (OLD.status='reserved' AND NEW.status IN ('committed','released')) THEN
    RAISE EXCEPTION 'invalid_store_sms_usage_transition';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS store_sms_usage_transition ON store_sms_usage;
CREATE TRIGGER store_sms_usage_transition BEFORE UPDATE OR DELETE ON store_sms_usage
  FOR EACH ROW EXECUTE FUNCTION enforce_store_sms_usage_transition();

COMMENT ON TABLE store_sms_billing_config IS 'Platform-controlled per-store SMS allowance and wallet overage rate. No configuration means sends are blocked.';
COMMENT ON TABLE store_sms_usage IS 'Immutable per-event SMS segment billing record; reserved usage consumes allowance until settled or released.';
