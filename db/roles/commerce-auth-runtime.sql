-- Dedicated least-privilege database role for Better Auth.
-- Run once as the Neon project owner. The application login role must be commerce_app.
-- Better Auth's PostgreSQL adapter uses public."user", public.session,
-- public.account and public.verification by default. Confirm names before applying.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_runtime') THEN
    CREATE ROLE commerce_auth_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE commerce_auth_runtime NOLOGIN NOBYPASSRLS;
GRANT commerce_auth_runtime TO commerce_app;
GRANT USAGE ON SCHEMA public TO commerce_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."user", public.session, public.account, public.verification
  TO commerce_auth_runtime;

-- Verify using commerce_app with startup option -c role=commerce_auth_runtime:
-- SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Expected: commerce_auth_runtime | false
-- Verify this role cannot read commerce tables:
-- SELECT * FROM public.stores LIMIT 1; -- must fail with permission denied
