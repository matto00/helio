-- HEL-536: envelope-encrypted, owner-scoped storage for third-party connector
-- credentials (v1.9 connectors build on this rather than inventing per-connector
-- schemes; see openspec/changes/connector-credential-encryption/design.md).
--
-- No column here holds plaintext or, on its own, is sufficient to decrypt a
-- row -- the master key (CONNECTOR_MASTER_KEY) never touches the database.
-- `name` is a caller-chosen label (e.g. "Stripe API key"), not secret.
--
-- RLS follows the V35/V42 owner-only pattern exactly: single USING clause,
-- no WITH CHECK, so the same predicate also gates INSERT. Reads/writes go
-- through DbContext.withUserContext on the app pool, same as api_tokens
-- (V38). helio_privileged access is inherited from V38's
-- ALTER DEFAULT PRIVILEGES (same migrating role creates this table).

CREATE TABLE connector_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,               -- caller-chosen label, not secret
  key_id           TEXT NOT NULL,                -- which master key wrapped the data key (rotation)
  wrapped_data_key BYTEA NOT NULL,               -- data key, AES-256-GCM under the master key
  nonce_dek        BYTEA NOT NULL,               -- GCM nonce for the wrapped-data-key layer
  ciphertext       BYTEA NOT NULL,               -- credential value, AES-256-GCM under the data key
  nonce_value      BYTEA NOT NULL,               -- GCM nonce for the value layer
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covers the owner-only policy predicate (V37 pattern).
CREATE INDEX idx_connector_credentials_user_id ON connector_credentials (user_id);

ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_credentials FORCE ROW LEVEL SECURITY;

-- Owner-only: reads/writes on the app pool see only the caller's own rows.
-- With no WITH CHECK clause the USING expression also gates INSERT, so a
-- user cannot create a credential for another user_id.
CREATE POLICY connector_credentials_owner ON connector_credentials
  USING (user_id = current_setting('app.current_user_id')::uuid);
