-- Meter accepted email sends against the subscription's monthly plan allowance.
CREATE TABLE IF NOT EXISTS email_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  message_event_id uuid NOT NULL UNIQUE REFERENCES message_events(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','accepted','released','unknown')),
  provider_reference text,
  amount integer NOT NULL DEFAULT 1 CHECK (amount=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_usage_ledger_period_idx
 ON email_usage_ledger(store_id,period_start,status);
ALTER TABLE email_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_usage_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_usage_member_read ON email_usage_ledger;
CREATE POLICY email_usage_member_read ON email_usage_ledger FOR SELECT
 USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id=email_usage_ledger.store_id
   AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid));
DROP POLICY IF EXISTS email_usage_worker_access ON email_usage_ledger;
CREATE POLICY email_usage_worker_access ON email_usage_ledger FOR ALL
 USING (current_setting('app.email_worker',true)='true')
 WITH CHECK (current_setting('app.email_worker',true)='true');
GRANT SELECT,INSERT,UPDATE,DELETE ON email_usage_ledger TO commerce_runtime;

DROP POLICY IF EXISTS message_events_email_worker_access ON message_events;
CREATE POLICY message_events_email_worker_access ON message_events FOR ALL
 USING (current_setting('app.email_worker',true)='true')
 WITH CHECK (current_setting('app.email_worker',true)='true');

-- The email delivery worker reads the subscription and plan allowance while holding
-- the subscription row lock; it cannot read merchant subscriptions outside this flag.
DROP POLICY IF EXISTS subscriptions_email_worker_read ON subscriptions;
CREATE POLICY subscriptions_email_worker_read ON subscriptions FOR SELECT
 USING (current_setting('app.email_worker',true)='true');
