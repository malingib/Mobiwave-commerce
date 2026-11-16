-- Run once as the Neon project owner after the Better Auth tables exist.
-- AUTH_DATABASE_URL must authenticate as commerce_auth_app, a dedicated LOGIN
-- role inheriting only commerce_auth_runtime. Do not use startup role options.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_runtime') THEN
    CREATE ROLE commerce_auth_runtime NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_app') THEN
    CREATE ROLE commerce_auth_app LOGIN INHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE commerce_auth_runtime NOLOGIN NOBYPASSRLS;
GRANT commerce_auth_runtime TO commerce_auth_app;
GRANT USAGE ON SCHEMA public TO commerce_auth_runtime;

-- Keep commerce data out of the Better Auth role, including privileges that
-- may have been granted by earlier migrations.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM commerce_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."user", public.session, public.account, public.verification
  TO commerce_auth_runtime;
REVOKE ALL ON TABLE public.stores, public.store_memberships, public.store_domains,
  public.products, public.orders, public.order_items, public.payment_attempts,
  public.subscriptions, public.message_events, public.audit_events
  FROM commerce_auth_runtime;

-- Set a strong password for commerce_auth_app in Neon and use its connection
-- string as AUTH_DATABASE_URL. Never expose this credential to browser code.
-- Verify as commerce_auth_app: current_user=commerce_auth_app, rolbypassrls=false.
