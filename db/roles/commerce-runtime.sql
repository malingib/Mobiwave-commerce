-- Run once as the Neon project owner after creating the login role "commerce_app".
-- The application login role may have BYPASSRLS; application queries must use
-- the non-login commerce_runtime role. Better Auth uses commerce_auth_runtime.
-- Do not use the Neon owner connection string in the application.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime') THEN
    CREATE ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
GRANT commerce_runtime TO commerce_app;
GRANT USAGE ON SCHEMA public TO commerce_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commerce_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commerce_runtime;

-- Do not automatically grant future tables to the commerce runtime role.
-- Each application migration must grant only the privileges its new objects need.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM commerce_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM commerce_runtime;

-- Keep Better Auth's identity/session tables out of the commerce data role.
REVOKE ALL ON TABLE public."user", public.session, public.account, public.verification
  FROM commerce_runtime;

-- Verify using commerce_app with startup option -c role=commerce_runtime:
-- SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Expected: commerce_runtime | false
