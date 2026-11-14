-- Public routing is available only for verified, explicitly activated custom domains.
DROP POLICY IF EXISTS domains_public_active_read ON store_domains;
CREATE POLICY domains_public_active_read ON store_domains FOR SELECT
  USING (
    status = 'active'
    AND verified_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM stores s
      WHERE s.id = store_domains.store_id
        AND s.status = 'active'
    )
  );

-- Platform administrators may activate or disable verified custom domains.
DROP POLICY IF EXISTS domains_superadmin_manage ON store_domains;
CREATE POLICY domains_superadmin_manage ON store_domains FOR ALL
  USING (current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.admin', true) = 'true');

GRANT SELECT, INSERT, UPDATE, DELETE ON store_domains TO commerce_runtime;
