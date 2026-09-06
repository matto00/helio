-- HEL-590: revocable share-link tokens for public dashboard read access
-- (openspec/changes/share-link-token-management). A token is a fallback
-- authorization path consulted only when grant-based resolution denies
-- (see AclDirective.authorizeResourceWithSharing / design.md D5); it never
-- widens what a public-viewer grant already exposes.
--
-- Only `token_hash` (SHA-256 hex of the CSPRNG-generated raw token) is
-- stored -- the plaintext secret is returned once at creation and never
-- persisted (design.md D2/D3).
--
-- RLS follows the V92 owner-only idiom exactly: single USING clause, no
-- WITH CHECK, keyed by `user_id` (the dashboard owner, not the dashboard
-- itself -- `dashboard_id` alone can't be checked against
-- app.current_user_id without a join). Owner-facing repository methods
-- (insert/findByDashboard/revoke) go through the app pool
-- (ctx.withUserContext) so this policy is actually exercised by shipped
-- code; the anonymous validation lookup (findActiveByHash) goes through
-- the privileged pool since there is no app.current_user_id to set for an
-- unauthenticated caller (design.md D6).

-- `dashboards.id` is TEXT (V1__init.sql), not UUID -- `dashboard_id` here follows suit so the FK
-- can actually be declared; every other column stays UUID (both `users.id` and this table's own
-- generated `id` are UUID already).
CREATE TABLE share_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index on the hash: lookup key for the anonymous validation path,
-- and guarantees no two tokens can ever collide (astronomically unlikely
-- given 256-bit entropy, but the constraint is free and closes the gap).
CREATE UNIQUE INDEX idx_share_tokens_token_hash ON share_tokens (token_hash);

-- Covers the owner-facing list/manage queries (findByDashboard).
CREATE INDEX idx_share_tokens_dashboard_id ON share_tokens (dashboard_id);

ALTER TABLE share_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_tokens FORCE ROW LEVEL SECURITY;

-- Owner-only: reads/writes on the app pool see only the caller's own rows.
-- With no WITH CHECK clause the USING expression also gates INSERT, so a
-- user cannot create a share token attributed to another user_id.
CREATE POLICY share_tokens_owner ON share_tokens
  USING (user_id = current_setting('app.current_user_id')::uuid);
