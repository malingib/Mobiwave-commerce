-- Wallet ledger and atomic reservations for wallet-funded SMS overage.
-- Monetary values are integer minor units (KES cents) to avoid floating-point drift.
CREATE TABLE IF NOT EXISTS store_wallet_accounts (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  currency char(3) NOT NULL DEFAULT 'KES',
  available_balance_minor bigint NOT NULL DEFAULT 0 CHECK (available_balance_minor >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','closed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS store_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('top_up','sms_reserve','sms_release','adjustment','refund')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  idempotency_key text NOT NULL,
  reference_type text,
  reference_id text,
  description text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, idempotency_key),
  CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS store_wallet_transactions_recent_idx ON store_wallet_transactions(store_id, created_at DESC);
CREATE TABLE IF NOT EXISTS store_wallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released')),
  reference_type text NOT NULL DEFAULT 'sms',
  reference_id text,
  expires_at timestamptz,
  committed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, idempotency_key),
  UNIQUE (store_id, id)
);
CREATE INDEX IF NOT EXISTS store_wallet_reservations_expiry_idx ON store_wallet_reservations(expires_at)
  WHERE status = 'reserved' AND expires_at IS NOT NULL;
ALTER TABLE store_wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_wallet_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE store_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_wallet_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE store_wallet_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_wallet_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_wallet_accounts_member_read ON store_wallet_accounts;
CREATE POLICY store_wallet_accounts_member_read ON store_wallet_accounts FOR SELECT
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = store_wallet_accounts.store_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid) OR current_setting('app.admin', true) = 'true');
DROP POLICY IF EXISTS store_wallet_accounts_system_write ON store_wallet_accounts;
CREATE POLICY store_wallet_accounts_system_write ON store_wallet_accounts FOR ALL
  USING (current_setting('app.wallet_worker', true) = 'true' OR current_setting('app.admin', true) = 'true'
    OR current_setting('app.mpesa_callback', true) = 'true')
  WITH CHECK (current_setting('app.wallet_worker', true) = 'true' OR current_setting('app.admin', true) = 'true'
    OR current_setting('app.mpesa_callback', true) = 'true');
DROP POLICY IF EXISTS store_wallet_transactions_member_read ON store_wallet_transactions;
CREATE POLICY store_wallet_transactions_member_read ON store_wallet_transactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = store_wallet_transactions.store_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid) OR current_setting('app.admin', true) = 'true');
DROP POLICY IF EXISTS store_wallet_transactions_system_write ON store_wallet_transactions;
CREATE POLICY store_wallet_transactions_system_write ON store_wallet_transactions FOR INSERT
  WITH CHECK (current_setting('app.wallet_worker', true) = 'true' OR current_setting('app.admin', true) = 'true'
    OR current_setting('app.mpesa_callback', true) = 'true');
DROP POLICY IF EXISTS store_wallet_reservations_member_read ON store_wallet_reservations;
CREATE POLICY store_wallet_reservations_member_read ON store_wallet_reservations FOR SELECT
  USING (EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id = store_wallet_reservations.store_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid) OR current_setting('app.admin', true) = 'true');
DROP POLICY IF EXISTS store_wallet_reservations_system_write ON store_wallet_reservations;
CREATE POLICY store_wallet_reservations_system_write ON store_wallet_reservations FOR ALL
  USING (current_setting('app.wallet_worker', true) = 'true' OR current_setting('app.admin', true) = 'true')
  WITH CHECK (current_setting('app.wallet_worker', true) = 'true' OR current_setting('app.admin', true) = 'true');
GRANT SELECT, INSERT, UPDATE, DELETE ON store_wallet_accounts TO commerce_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON store_wallet_transactions TO commerce_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON store_wallet_reservations TO commerce_runtime;
COMMENT ON TABLE store_wallet_transactions IS 'Append-only wallet movements. amount_minor is signed; positive credits and negative debits.';
COMMENT ON TABLE store_wallet_reservations IS 'Idempotent holds against available wallet balance. Reservation debit is recorded immediately; release refunds it.';
