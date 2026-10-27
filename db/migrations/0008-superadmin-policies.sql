CREATE POLICY stores_superadmin_access ON stores FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');
CREATE POLICY memberships_superadmin_read ON store_memberships FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY domains_superadmin_read ON store_domains FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY products_superadmin_read ON products FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY orders_superadmin_read ON orders FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY order_items_superadmin_read ON order_items FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY payments_superadmin_read ON payment_attempts FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY subscriptions_superadmin_access ON subscriptions FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');
CREATE POLICY messages_superadmin_read ON message_events FOR SELECT
  USING (current_setting('app.admin', true) = 'true');
CREATE POLICY audit_superadmin_access ON audit_events FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');