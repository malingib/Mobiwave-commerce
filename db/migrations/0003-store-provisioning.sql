CREATE POLICY stores_provisioning_insert ON stores FOR INSERT
  WITH CHECK (current_setting('app.provisioning', true) = 'true');
CREATE POLICY membership_provisioning_insert ON store_memberships FOR INSERT
  WITH CHECK (current_setting('app.provisioning', true) = 'true');
CREATE POLICY subscriptions_provisioning_insert ON subscriptions FOR INSERT
  WITH CHECK (current_setting('app.provisioning', true) = 'true');
