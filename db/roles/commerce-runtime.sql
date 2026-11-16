-- Run once as the Neon project owner after creating the login role "commerce_app".
-- commerce_app must remain a NOBYPASSRLS login and inherit the commerce_runtime
-- role's grants. Do not depend on SET ROLE startup parameters: Neon poolers reject
-- custom startup options such as "-c role=commerce_runtime".

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime') THEN
    CREATE ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
ALTER ROLE commerce_app LOGIN INHERIT NOBYPASSRLS;
GRANT commerce_runtime TO commerce_app;
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

-- Verify as commerce_app (without SET ROLE):
-- SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user);
-- Expected: commerce_app | false
-- Verify commerce_app can read orders but cannot read Better Auth identity/session tables.
