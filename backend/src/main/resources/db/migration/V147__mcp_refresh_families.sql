-- HEL-1713: refresh-token family state for the helio-mcp OAuth connector.
--
-- helio-mcp seals every token it hands out and stores nothing, so it cannot tell a replayed refresh
-- token from a fresh one; two Cloud Run instances share no memory. This table is the one shared
-- record: per family, a hash of the CURRENT refresh token id, advanced by an atomic
-- compare-and-swap on rotation. The refresh token itself and its id are never stored, only
-- sha256(jti); client_id_hash is sha256 of the sealed client id.
--
-- api_token_id ... ON DELETE CASCADE is the revocation link: deleting the connector's PAT (Settings,
-- or the reuse path, which deletes it on purpose) deletes every family it backs. expires_at equals the
-- PAT's own expiry (90 days from consent), so a refresh chain never outlives the PAT the user
-- consented to. The reuse path therefore needs no revoked_at column: a revoked family is a deleted one.
--
-- RLS follows the V42 owner-only pattern (ENABLE + FORCE, one policy, no WITH CHECK so USING also gates
-- INSERT). Every access runs on the app pool under the PAT owner's user context; nothing here uses the
-- privileged pool, so no explicit GRANT to helio_privileged is needed beyond V38's default privileges.
--
-- Additive only -- never edit this file once applied (shared dev DB; Flyway checksums the whole file,
-- comments included).

CREATE TABLE mcp_refresh_families (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_token_id     UUID NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  client_id_hash   TEXT NOT NULL,
  resource         TEXT NOT NULL,
  current_jti_hash TEXT NOT NULL,
  generation       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_rotated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL
);

-- user_id covers the owner-only policy predicate (V37 pattern); api_token_id covers the cascade and
-- the rotate lookup.
CREATE INDEX idx_mcp_refresh_families_user_id ON mcp_refresh_families (user_id);
CREATE INDEX idx_mcp_refresh_families_api_token_id ON mcp_refresh_families (api_token_id);

ALTER TABLE mcp_refresh_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_refresh_families FORCE ROW LEVEL SECURITY;

CREATE POLICY mcp_refresh_families_owner ON mcp_refresh_families
  USING (user_id = current_setting('app.current_user_id')::uuid);
