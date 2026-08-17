-- HEL-703: user tiers (free|beta|owner) + the beta-tier daily chat-cap counter.
--
-- `users.tier` gates access to `AssistantConversationRoutes` (ChatAccessService, application
-- layer) -- `free` is denied every endpoint, `beta` is capped per UTC day, `owner` is unlimited.
-- TEXT + CHECK (not a Postgres ENUM like V9's auth_provider) -- design.md D1: a CHECK is equally
-- strict and cheaper to evolve (no migration-with-lock to add a tier later), and Slick maps both
-- shapes to a plain String column anyway. DEFAULT 'free' backfills every pre-existing row.
--
-- `users` itself carries NO RLS (same as V6/V8/V9 -- it is the pre-identity table
-- `SlickUserSessionRepository`/`AuthDirectives` read BEFORE any user context exists).

ALTER TABLE users
  ADD COLUMN tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'beta', 'owner'));

-- `assistant_daily_usage` counts a beta-tier user's converse-endpoint sends for the current UTC
-- day (design.md D5) -- the transcript blob (`assistant_conversations`, V80) has no per-message
-- timestamps to count from. One row per (user, day); `AssistantDailyUsageRepository` enforces the
-- cap with a single atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE message_count < :limit
-- RETURNING` statement -- no explicit transaction needed for correctness, and no separate
-- idx_assistant_daily_usage_user_id is needed: user_id is the PK's leading column already.
--
-- Unlike `users` above, every access to this table happens strictly post-`authenticate` (there is
-- no pre-identity read path here), so it gets full RLS -- matching the direct-owner pattern of
-- `api_tokens` (V42) / `assistant_conversations` (V80) exactly.

CREATE TABLE assistant_daily_usage (
  user_id       UUID NOT NULL REFERENCES users(id),
  usage_date    DATE NOT NULL,
  message_count INT  NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE assistant_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_daily_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY assistant_daily_usage_owner ON assistant_daily_usage
  USING (user_id = current_setting('app.current_user_id')::uuid);
