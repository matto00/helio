-- HEL-1019: cross-instance OAuth CSRF state storage (openspec/changes/fix-oauth-state-cross-instance).
-- Production runs --max-instances=2 --min-instances=0; the prior in-process
-- ConcurrentHashMap store (`object AuthService`) lost state whenever the
-- consent redirect and the callback landed on different processes, or the
-- issuing process scaled to zero during the 30-60s consent wait. This table
-- makes state visible to every serving process.
--
-- `oauth_states` is written by UNAUTHENTICATED requests, before any user
-- identity exists -- there is no `app.current_user_id` to scope a policy to
-- and no owner column to key one on. Unlike `share_tokens` (V101) and
-- `connector_completion_tokens` (V103), which are owner-scoped with a single
-- anonymous read/write carve-out, this table has NO legitimate ordinary-role
-- access at all: every access to this table MUST go through
-- `DbContext.withSystemContext` (the `helio_privileged`, BYPASSRLS pool).
-- The deny-all policy below is the only thing enforcing that boundary --
-- do not add an ordinary-role policy to this table.
--
-- Mirrors `V102__share_tokens_privileged_grant.sql`'s rationale for the
-- explicit GRANT rather than relying on V38's `ALTER DEFAULT PRIVILEGES`:
-- this repo has had three prod-only RLS/grant incidents (HEL-974) that
-- local/CI/prod-dump testing as a superuser cannot catch, because Flyway and
-- every test suite connect as a superuser and never observe a missing grant.
--
-- Additive only -- never edit this file once applied. The dev database is
-- shared across worktrees and Flyway checksums the whole file, comments
-- included, so an edit after the fact is a boot failure for every other
-- worktree on this machine.

CREATE TABLE oauth_states (
  state      TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Supports the expiry-driven prune (`WHERE expires_at <= now()`).
CREATE INDEX idx_oauth_states_expires_at ON oauth_states (expires_at);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states FORCE ROW LEVEL SECURITY;

-- Deny-all: there is no legitimate ordinary-role access to this table.
-- The privileged pool (helio_privileged, BYPASSRLS) skips this policy
-- entirely, which is the only intended access path.
CREATE POLICY oauth_states_deny_all ON oauth_states
  USING (false);

-- Explicit grant for the privileged pool -- see header. Do NOT rely on V38's
-- ALTER DEFAULT PRIVILEGES for this table.
GRANT SELECT, INSERT, DELETE ON oauth_states TO helio_privileged;
