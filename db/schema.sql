-- MobiWave Commerce PostgreSQL foundation.
-- Apply through versioned migrations; never run against production manually without review.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE store_status AS ENUM ('draft', 'active', 'suspended');
CREATE TYPE member_role AS ENUM ('owner', 'manager', 'staff');
CREATE TYPE product_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'processing', 'ready', 'shipped', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('unpaid', 'pending', 'paid', 'failed', 'refunded');
CREATE TYPE payment_method AS ENUM ('cash_on_delivery', 'manual', 'mpesa', 'pesapal', 'paystack');
CREATE TYPE domain_status AS ENUM ('pending_verification', 'verified', 'active', 'disabled');

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  status store_status NOT NULL DEFAULT 'draft',
  currency char(3) NOT NULL DEFAULT 'KES',
  timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  contact_email text,
  contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_memberships (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role member_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);
CREATE INDEX store_memberships_user_idx ON store_memberships(user_id);

CREATE TABLE store_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  hostname text NOT NULL UNIQUE,
  status domain_status NOT NULL DEFAULT 'pending_verification',
  verification_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  verified_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hostname = lower(hostname)),
  CHECK (position('/' in hostname) = 0)
);
CREATE INDEX store_domains_store_idx ON store_domains(store_id);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  sku text,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  stock_quantity integer CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  status product_status NOT NULL DEFAULT 'draft',
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug),
  UNIQUE (store_id, sku),
  UNIQUE (store_id, id)
);
CREATE INDEX products_public_listing_idx ON products(store_id, status, created_at DESC);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_number bigint GENERATED ALWAYS AS IDENTITY,
  customer_name text NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 160),
  customer_email text,
  customer_phone text NOT NULL,
  delivery_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  status order_status NOT NULL DEFAULT 'pending',
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  payment_method payment_method NOT NULL DEFAULT 'cash_on_delivery',
  currency char(3) NOT NULL DEFAULT 'KES',
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  delivery_fee_minor bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  customer_note text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  UNIQUE (store_id, order_number),
  UNIQUE (store_id, idempotency_key),
  CHECK (total_minor = subtotal_minor + delivery_fee_minor)
);
CREATE INDEX orders_store_recent_idx ON orders(store_id, created_at DESC);
CREATE INDEX orders_store_status_idx ON orders(store_id, status, created_at DESC);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  sku text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id) ON DELETE SET NULL
);
CREATE INDEX order_items_order_idx ON order_items(store_id, order_id);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  provider payment_method NOT NULL,
  provider_reference text,
  merchant_request_id text,
  checkout_request_id text,
  status payment_status NOT NULL DEFAULT 'pending',
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  callback_payload jsonb,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, idempotency_key),
  UNIQUE (provider, provider_reference)
);
CREATE INDEX payment_attempts_order_idx ON payment_attempts(store_id, order_id, created_at DESC);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  plan_code text NOT NULL DEFAULT 'free' CHECK (plan_code IN ('free', 'growth', 'pro', 'business')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id uuid,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'whatsapp')),
  recipient text NOT NULL,
  template_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  provider_reference text,
  dedupe_key text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE SET NULL,
  UNIQUE (store_id, dedupe_key)
);
CREATE INDEX message_events_queue_idx ON message_events(status, created_at) WHERE status = 'queued';

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  actor_user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_store_recent_idx ON audit_events(store_id, created_at DESC);

-- Tenant isolation: app sets app.user_id only after authenticating the request.
-- Every authenticated database transaction must use SET LOCAL app.user_id = '<verified UUID>'.
CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
CREATE POLICY stores_member_access ON stores
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = stores.id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = stores.id AND m.user_id = app_user_id()));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['store_memberships','store_domains','products','orders','order_items','payment_attempts','subscriptions','message_events','audit_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE POLICY membership_self_access ON store_memberships
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

CREATE POLICY domains_member_access ON store_domains
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = store_domains.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = store_domains.store_id AND m.user_id = app_user_id()));
CREATE POLICY products_member_access ON products
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = products.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = products.store_id AND m.user_id = app_user_id()));
CREATE POLICY orders_member_access ON orders
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = orders.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = orders.store_id AND m.user_id = app_user_id()));
CREATE POLICY order_items_member_access ON order_items
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = order_items.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = order_items.store_id AND m.user_id = app_user_id()));
CREATE POLICY payment_attempts_member_access ON payment_attempts
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = payment_attempts.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = payment_attempts.store_id AND m.user_id = app_user_id()));
CREATE POLICY subscriptions_member_access ON subscriptions
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = subscriptions.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = subscriptions.store_id AND m.user_id = app_user_id()));
CREATE POLICY message_events_member_access ON message_events
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = message_events.store_id AND m.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = message_events.store_id AND m.user_id = app_user_id()));
CREATE POLICY audit_events_member_access ON audit_events
  USING (store_id IS NULL OR EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = audit_events.store_id AND m.user_id = app_user_id()))
  WITH CHECK (store_id IS NULL OR EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = audit_events.store_id AND m.user_id = app_user_id()));

-- Public storefront access is intentionally not granted to browser roles here.
-- A server-side public catalog service must resolve an active hostname, then query
-- only that store's published products using a dedicated least-privilege DB role.
