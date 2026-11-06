-- Permit the token-authenticated M-Pesa callback transaction to read the
-- order's customer phone while correlating the provider callback to its attempt.
-- The setting is transaction-local and is set only inside the callback handler.
DROP POLICY IF EXISTS orders_mpesa_callback_select ON orders;
CREATE POLICY orders_mpesa_callback_select ON orders
  FOR SELECT
  USING (current_setting('app.mpesa_callback', true) = 'true');
