-- Allow the authenticated merchant STK flow to read an enabled platform fallback configuration.
DROP POLICY IF EXISTS mpesa_configurations_platform_order_read ON mpesa_configurations;
CREATE POLICY mpesa_configurations_platform_order_read ON mpesa_configurations FOR SELECT
  USING (
    scope_type = 'platform'
    AND enabled = true
    AND current_setting('app.mpesa_order', true) = 'true'
  );
