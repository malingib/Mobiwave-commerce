-- Commerce plan catalogue: permanent Free tier and six approved plan levels.
-- Schema/catalogue only. No production changes or payment initiation.

ALTER TABLE commerce_plans DROP CONSTRAINT IF EXISTS commerce_plans_code_check;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_code_check;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscription_payment_attempts DROP CONSTRAINT IF EXISTS subscription_payment_attempts_plan_code_fkey;

UPDATE subscription_payment_attempts SET plan_code='professional' WHERE plan_code='pro';
UPDATE subscriptions SET plan_code='professional' WHERE plan_code='pro';
UPDATE commerce_plans SET code='professional',name='Professional',
 description='For established teams that need more operational capacity.' WHERE code='pro';

ALTER TABLE commerce_plans ADD CONSTRAINT commerce_plans_code_check
 CHECK (code IN ('free','starter','growth','professional','business','enterprise'));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_code_check
 CHECK (plan_code IN ('free','starter','growth','professional','business','enterprise'));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
 CHECK (status IN ('trialing','active','past_due','suspended','cancelled','expired'));
ALTER TABLE subscription_payment_attempts ADD CONSTRAINT subscription_payment_attempts_plan_code_fkey
 FOREIGN KEY (plan_code) REFERENCES commerce_plans(code);

INSERT INTO commerce_plans (code,name,description,amount_minor,currency,billing_interval,is_active,limits,features)
VALUES
 ('free','Free','A permanent free plan for merchants getting started.',0,'KES','monthly',true,
  '{"maxProducts":20,"maxDomains":0,"maxMembers":1,"includedEmailSendsPerMonth":20,"includedSmsSegmentsPerMonth":20}'::jsonb,
  '["Free forever — no trial expiry or payment card required","MobiWave storefront and platform subdomain","Product catalogue and checkout","M-Pesa checkout","Basic order management","20 included email sends per month","20 included SMS segments per month","MobiWave platform branding"]'::jsonb),
 ('starter','Starter','For small businesses ready for a custom domain and more capacity.',29900,'KES','monthly',true,
  '{"maxProducts":100,"maxDomains":1,"maxMembers":1,"includedEmailSendsPerMonth":30,"includedSmsSegmentsPerMonth":30}'::jsonb,
  '["Everything in Free","One custom domain","100 products","30 included email sends per month","30 included SMS segments per month"]'::jsonb),
 ('growth','Growth','For growing businesses managing more products and customers.',99900,'KES','monthly',true,
  '{"maxProducts":500,"maxDomains":1,"maxMembers":3,"includedEmailSendsPerMonth":50,"includedSmsSegmentsPerMonth":50}'::jsonb,
  '["Everything in Starter","500 products","Up to 3 staff accounts","50 included email sends per month","50 included SMS segments per month","Advanced customer and sales insights"]'::jsonb),
 ('professional','Professional','For established teams that need advanced operations.',249900,'KES','monthly',true,
  '{"maxProducts":2500,"maxDomains":2,"maxMembers":10,"includedEmailSendsPerMonth":100,"includedSmsSegmentsPerMonth":100}'::jsonb,
  '["Everything in Growth","2,500 products","Up to 10 staff accounts","Two custom domains","100 included email sends per month","100 included SMS segments per month","Advanced reports and automation"]'::jsonb),
 ('business','Business','For larger operations with higher capacity and team needs.',499900,'KES','monthly',true,
  '{"maxProducts":10000,"maxDomains":5,"maxMembers":25,"includedEmailSendsPerMonth":200,"includedSmsSegmentsPerMonth":200}'::jsonb,
  '["Everything in Professional","10,000 products","Up to 25 staff accounts","Five custom domains","200 included email sends per month","200 included SMS segments per month","Priority support and advanced controls"]'::jsonb),
 ('enterprise','Enterprise','Custom capacity, onboarding and commercial terms.',NULL,'KES','monthly',true,
  '{"maxProducts":null,"maxDomains":null,"maxMembers":null,"includedEmailSendsPerMonth":null,"includedSmsSegmentsPerMonth":null}'::jsonb,
  '["Everything in Business","Negotiated product, staff and domain capacity","Negotiated email and SMS allowances","Custom onboarding and support"]'::jsonb)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
 amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,billing_interval=EXCLUDED.billing_interval,
 is_active=EXCLUDED.is_active,limits=EXCLUDED.limits,features=EXCLUDED.features,updated_at=now();

UPDATE subscriptions SET status='active',current_period_start=NULL,current_period_end=NULL,updated_at=now()
WHERE plan_code='free' AND status IN ('trialing','past_due','expired');

COMMENT ON COLUMN commerce_plans.limits IS
 'Server-enforced plan entitlements including capacity and monthly email/SMS allowances. Enterprise limits and allowances are negotiated.';
COMMENT ON TABLE commerce_plans IS
 'Commerce plan catalogue. Free is permanent and does not expire; Enterprise terms are negotiated.';
