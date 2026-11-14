-- Bootstrap the non-login commerce role before applying migrations that grant it table access.
-- Run as the Neon project owner after creating the commerce_app login role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime') THEN
    CREATE ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
