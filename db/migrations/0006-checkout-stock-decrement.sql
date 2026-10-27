CREATE POLICY products_checkout_stock_update ON products FOR UPDATE
  USING (status = 'active' AND current_setting('app.checkout', true) = 'true')
  WITH CHECK (status = 'active' AND current_setting('app.checkout', true) = 'true' AND (stock_quantity IS NULL OR stock_quantity >= 0));
