-- Consent evidence for proactive WhatsApp template messages.
CREATE TABLE channel_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','instagram')),
  status text NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
  source text NOT NULL CHECK (source IN ('checkout','website_form','in_store','written','imported','other')),
  evidence_ref text NOT NULL CHECK (length(trim(evidence_ref)) BETWEEN 8 AND 2000),
  captured_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, identity_id, channel),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, identity_id, channel)
    REFERENCES channel_identities(store_id, id, channel) ON DELETE CASCADE,
  FOREIGN KEY (store_id, captured_by)
    REFERENCES store_memberships(store_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX channel_consents_status_idx ON channel_consents(store_id, channel, status);

CREATE TABLE channel_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('granted','revoked')),
  actor_user_id uuid NOT NULL,
  source text NOT NULL,
  evidence_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, consent_id)
    REFERENCES channel_consents(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, actor_user_id)
    REFERENCES store_memberships(store_id, user_id) ON DELETE RESTRICT
);

ALTER TABLE channel_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_consents_member_access ON channel_consents
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM store_memberships sm
     WHERE sm.store_id=channel_consents.store_id
       AND sm.user_id=current_setting('app.user_id',true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships sm
     WHERE sm.store_id=channel_consents.store_id
       AND sm.user_id=current_setting('app.user_id',true)::uuid
  ));
CREATE POLICY channel_consents_worker_read ON channel_consents
  FOR SELECT
  USING (current_setting('app.channel_worker',true)='true');

ALTER TABLE channel_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_consent_events_member_access ON channel_consent_events
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM store_memberships sm
     WHERE sm.store_id=channel_consent_events.store_id
       AND sm.user_id=current_setting('app.user_id',true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM store_memberships sm
     WHERE sm.store_id=channel_consent_events.store_id
       AND sm.user_id=current_setting('app.user_id',true)::uuid
  ));
CREATE POLICY channel_consent_events_worker_read ON channel_consent_events
  FOR SELECT
  USING (current_setting('app.channel_worker',true)='true');

GRANT SELECT,INSERT,UPDATE,DELETE ON channel_consents,channel_consent_events TO commerce_runtime;

COMMENT ON TABLE channel_consents IS
  'Merchant-recorded evidence of customer channel opt-in. Proactive WhatsApp template sends require status=granted.';
COMMENT ON TABLE channel_consent_events IS
  'Append-only audit trail of channel consent grants and revocations.';
