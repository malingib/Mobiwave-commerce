-- Subscription dunning lifecycle and idempotent notification ledger.
-- Day 1 and Day 2 are two reminders/payment-retry prompts; Day 3 suspends paid entitlements.
-- Store records and login remain available: do not change stores.status here.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz,
  ADD COLUMN IF NOT EXISTS dunning_attempts integer NOT NULL DEFAULT 0 CHECK (dunning_attempts BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS next_dunning_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_cycle_key text;

CREATE INDEX IF NOT EXISTS subscriptions_dunning_due_idx
  ON subscriptions(next_dunning_at, past_due_since)
  WHERE plan_code <> 'free' AND status IN ('active','past_due');

CREATE TABLE IF NOT EXISTS subscription_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cycle_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('payment_due','retry_day_1','retry_day_2','suspended','restored','payment_received')),
  event_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id,cycle_key,event_type)
);
CREATE INDEX IF NOT EXISTS subscription_billing_events_store_recent_idx
  ON subscription_billing_events(store_id,created_at DESC);

ALTER TABLE subscription_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_billing_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_billing_events_member_read ON subscription_billing_events;
CREATE POLICY subscription_billing_events_member_read ON subscription_billing_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM store_memberships m
    WHERE m.store_id=subscription_billing_events.store_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid
  ));
DROP POLICY IF EXISTS subscription_billing_events_worker_access ON subscription_billing_events;
CREATE POLICY subscription_billing_events_worker_access ON subscription_billing_events FOR ALL
  USING (current_setting('app.billing_worker',true)='true')
  WITH CHECK (current_setting('app.billing_worker',true)='true');
GRANT SELECT,INSERT,UPDATE,DELETE ON subscription_billing_events TO commerce_runtime;

DROP POLICY IF EXISTS subscriptions_billing_worker_access ON subscriptions;
CREATE POLICY subscriptions_billing_worker_access ON subscriptions FOR ALL
  USING (current_setting('app.billing_worker',true)='true')
  WITH CHECK (current_setting('app.billing_worker',true)='true');

-- The worker may enqueue only billing notifications. Existing message worker owns delivery.
DROP POLICY IF EXISTS message_events_billing_worker_insert ON message_events;
CREATE POLICY message_events_billing_worker_insert ON message_events FOR INSERT
  WITH CHECK (current_setting('app.billing_worker',true)='true' AND template_key IN ('subscription_dunning_day_1','subscription_dunning_day_2','subscription_suspended'));

-- The service worker reads only the store contact fields needed for notices.
DROP POLICY IF EXISTS stores_billing_worker_read ON stores;
CREATE POLICY stores_billing_worker_read ON stores FOR SELECT
 USING (current_setting('app.billing_worker',true)='true');

-- Existing paid subscriptions already in past_due enter the same Day 0-2 recovery clock.
UPDATE subscriptions
   SET past_due_since=COALESCE(past_due_since,current_period_end,updated_at,now()),
       next_dunning_at=COALESCE(next_dunning_at,COALESCE(current_period_end,updated_at,now())+interval '1 day'),
       billing_cycle_key=COALESCE(billing_cycle_key,to_char(COALESCE(current_period_end,updated_at,now()) AT TIME ZONE 'UTC','YYYYMMDDHH24MISS')),
       updated_at=now()
 WHERE plan_code<>'free' AND status='past_due';
