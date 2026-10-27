CREATE POLICY stores_public_active_read ON stores FOR SELECT
  USING (status = 'active');
CREATE POLICY products_public_catalog_read ON products FOR SELECT
  USING (status = 'active' AND EXISTS (SELECT 1 FROM stores s WHERE s.id = products.store_id AND s.status = 'active'));
CREATE POLICY orders_public_checkout_insert ON orders FOR INSERT
  WITH CHECK (
    status = 'pending' AND payment_status = 'unpaid'
    AND payment_method IN ('cash_on_delivery', 'manual')
    AND EXISTS (SELECT 1 FROM stores s WHERE s.id = orders.store_id AND s.status = 'active')
  );
CREATE POLICY order_items_public_checkout_insert ON order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p JOIN stores s ON s.id = p.store_id
      WHERE p.id = order_items.product_id AND p.store_id = order_items.store_id
        AND p.status = 'active' AND s.status = 'active'
    )
  );
