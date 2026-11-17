-- Allow the authenticated channel worker to resolve provider account IDs.
-- Merchant sessions still cannot read the connection registry without membership.
CREATE POLICY channel_connections_worker_read ON channel_connections
  FOR SELECT USING (current_setting('app.channel_worker', true) = 'true');
