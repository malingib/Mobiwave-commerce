-- Dedicated least-privilege database role for Better Auth.
-- Run once as the Neon project owner. The application login role must be commerce_app.
-- Do not use the Neon owner connection string in the application.
--
-- Better Auth's PostgreSQL adapter uses the public.user, public.session,
-- public.account and public.verification tables by default. Confirm these names
-- against the deployed schema before applying this script.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_runtime') THEN
    CREATE ROLE commerce_auth_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT commerce_auth_runtime TO commerce_app;
GRANT USAGE ON SCHEMA public TO commerce_auth_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."user", public.session, public.account, public.verification
  TO commerce_auth_runtime;

-- Better Auth is configured to generate UUIDs; it does not need sequence privileges.
-- Verify using the commerce_app login with startup option -c role=commerce_auth_runtime:
-- SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Expected: commerce_auth_runtime | false
-- Also verify that this role cannot read commerce tables:
-- SELECT * FROM stores LIMIT 1; -- must fail with permission denied
