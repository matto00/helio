-- HEL-148 Phase 1 (agent-native layer): durable Personal Access Tokens.
--
-- PATs are revocable agent credentials that resolve to a real user via the
-- standard AuthDirectives flow (session first, PAT fallback). Only a SHA-256
-- hash of the raw token is ever stored; the raw `helio_pat_<random>` value is
-- returned exactly once at creation and never persisted or logged.
--
-- RLS follows the V35 owner-only pattern: a user manages (list/revoke) only
-- their own tokens on the app pool. The authentication-time lookup by
-- token_hash necessarily runs BEFORE any user identity exists, so it goes
-- through the privileged pool (withSystemContext) exactly like the
-- user_sessions lookup — see ApiTokenRepository.findUserByTokenHash.
--
-- helio_privileged access to this new table is covered by the
-- ALTER DEFAULT PRIVILEGES grants in V38 (same migrating role creates it).

CREATE TABLE api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,   -- SHA-256 hex of the raw token, never the raw token
  name         TEXT NOT NULL,          -- human label ("fable-mcp")
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ             -- NULL = non-expiring
);

-- Covers the owner-only policy predicate (V37 pattern).
CREATE INDEX idx_api_tokens_user_id ON api_tokens (user_id);

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;

-- Owner-only: list/revoke on the app pool see only the caller's tokens.
-- With no WITH CHECK clause the USING expression also gates INSERT, so a
-- user cannot mint a token for another user_id.
CREATE POLICY api_tokens_owner ON api_tokens
  USING (user_id = current_setting('app.current_user_id')::uuid);
