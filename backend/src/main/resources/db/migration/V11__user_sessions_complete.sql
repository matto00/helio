-- Replace the minimal V7 user_sessions table with the complete schema
-- required for server-side session management (HEL-31).
-- V7 has no application code consuming it, so a clean drop+recreate is safe.
DROP TABLE IF EXISTS user_sessions CASCADE;

CREATE TABLE user_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  ip_address   TEXT,
  user_agent   TEXT,
  CONSTRAINT user_sessions_token_unique UNIQUE (token)
);
