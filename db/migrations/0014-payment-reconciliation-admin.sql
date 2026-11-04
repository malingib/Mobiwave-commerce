-- Platform-admin reconciliation is explicitly gated by the verified app.admin capability.
DROP POLICY IF EXISTS payment_attempts_admin_manage ON payment_attempts;
CREATE POLICY payment_attempts_admin_manage ON payment_attempts FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');

DROP POLICY IF EXISTS subscription_payment_attempts_admin_manage ON subscription_payment_attempts;
CREATE POLICY subscription_payment_attempts_admin_manage ON subscription_payment_attempts FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');

DROP POLICY IF EXISTS orders_admin_manage ON orders;
CREATE POLICY orders_admin_manage ON orders FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');

DROP POLICY IF EXISTS mpesa_receipt_claims_admin_manage ON mpesa_receipt_claims;
CREATE POLICY mpesa_receipt_claims_admin_manage ON mpesa_receipt_claims FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');
