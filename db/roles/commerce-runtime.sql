-- Run once as the Neon project owner after creating the login role "commerce_app".
-- The login role created by Neon has BYPASSRLS; the application connection string
-- must set the non-login runtime role at connection startup with:
-- options=-c%20role%3Dcommerce_runtime
-- Do not use the owner connection string in the application.

CREATE ROLE commerce_runtime NOLOGIN NOBYPASSRLS;
GRANT commerce_runtime TO commerce_app;
GRANT USAGE ON SCHEMA public TO commerce_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commerce_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commerce_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO commerce_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO commerce_runtime;

-- Verify this using a connection as commerce_app with the startup role option:
-- SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Expected: commerce_runtime | false
