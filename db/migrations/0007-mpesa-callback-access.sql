CREATE POLICY payment_attempts_mpesa_callback ON payment_attempts FOR ALL
  USING (current_setting('app.mpesa_callback', true) = 'true' AND provider = 'mpesa')
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true' AND provider = 'mpesa');
CREATE POLICY orders_mpesa_callback_update ON orders FOR UPDATE
  USING (current_setting('app.mpesa_callback', true) = 'true')
  WITH CHECK (current_setting('app.mpesa_callback', true) = 'true' AND payment_status IN ('paid', 'failed', 'pending', 'unpaid'));
