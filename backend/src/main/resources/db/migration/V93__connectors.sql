-- HEL-821: a saved, reusable, owner-scoped Connector (host + credential) that many
-- data sources can later reference (HEL-822), instead of each source re-entering
-- its own copy of a credential. See openspec/changes/connector-domain-model-credentials/
-- design.md Decision 1/2 for why this table uses real columns for identity/query
-- fields plus a `config` JSONB for kind-specific non-secret extras, rather than the
-- fully-opaque `data_sources.config` pattern.
--
-- The credential itself is never duplicated here -- `credential_id` references
-- connector_credentials(id) (V92, HEL-536), the one place envelope-encrypted
-- ciphertext is stored. `ON DELETE RESTRICT` so a credential can never be dropped
-- out from under a live Connector by accident.
--
-- RLS follows the V35/V92 owner-only pattern exactly: single USING clause, no
-- WITH CHECK, so the same predicate also gates INSERT.

CREATE TABLE connectors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,               -- DataSourceKind vocabulary (rest_api first)
  base_url      TEXT NOT NULL,
  config        JSONB NOT NULL DEFAULT '{}', -- kind-specific non-secret extras only
  credential_id UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covers the owner-only policy predicate (V37 pattern).
CREATE INDEX idx_connectors_owner_id ON connectors (owner_id);

ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors FORCE ROW LEVEL SECURITY;

CREATE POLICY connectors_owner ON connectors
  USING (owner_id = current_setting('app.current_user_id')::uuid);
