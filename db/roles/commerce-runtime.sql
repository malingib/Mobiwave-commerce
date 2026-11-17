-- Run once as the Neon project owner.
-- DATABASE_URL must authenticate as commerce_runtime_app, a dedicated LOGIN role
-- inheriting commerce_runtime. Do not use a BYPASSRLS Neon owner/admin login.
-- Do not depend on SET ROLE startup parameters: Neon poolers reject custom
-- startup options such as "-c role=commerce_runtime".

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime') THEN
    CREATE ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime_app') THEN
    CREATE ROLE commerce_runtime_app LOGIN INHERIT NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
GRANT commerce_runtime TO commerce_runtime_app;
GRANT USAGE ON SCHEMA public TO commerce_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commerce_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commerce_runtime;

-- Do not automatically grant future tables to the commerce runtime role.
-- Each application migration must explicitly grant only the privileges its new objects need.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM commerce_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM commerce_runtime;

-- Keep Better Auth's identity/session tables out of the commerce data role.
REVOKE ALL ON TABLE public."user", public.session, public.account, public.verification
  FROM commerce_runtime;

-- Set a strong password for commerce_runtime_app in Neon and use its connection
-- string as DATABASE_URL. Verify as commerce_runtime_app:
-- SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user);
-- Expected: commerce_runtime_app | false
-- It must read commerce tables but not Better Auth identity/session tables.
