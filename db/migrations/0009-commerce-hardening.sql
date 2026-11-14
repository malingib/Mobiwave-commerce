-- Commerce hardening: payment review state.
-- Keep the enum addition isolated: PostgreSQL requires the new enum value
-- to be committed before any later migration uses it.
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'review_required';
