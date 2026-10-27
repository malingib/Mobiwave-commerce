DROP POLICY stores_public_active_read ON stores;
CREATE POLICY stores_public_active_read ON stores FOR SELECT
  USING (status = 'active' AND nullif(current_setting('app.user_id', true), '') IS NULL);
DROP POLICY products_public_catalog_read ON products;
CREATE POLICY products_public_catalog_read ON products FOR SELECT
  USING (status = 'active' AND nullif(current_setting('app.user_id', true), '') IS NULL
    AND EXISTS (SELECT 1 FROM stores s WHERE s.id = products.store_id AND s.status = 'active'));
