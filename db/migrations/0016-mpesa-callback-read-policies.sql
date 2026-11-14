-- Daraja callbacks need narrowly scoped read access for their joined order/store rows.
DROP POLICY IF EXISTS orders_mpesa_callback_read ON orders;
CREATE POLICY orders_mpesa_callback_read ON orders FOR SELECT
  USING (current_setting('app.mpesa_callback', true) = 'true');

DROP POLICY IF EXISTS stores_mpesa_callback_read ON stores;
CREATE POLICY stores_mpesa_callback_read ON stores FOR SELECT
  USING (current_setting('app.mpesa_callback', true) = 'true');
