-- HEL-702: TOTP-based MFA (RFC 6238) as a second factor, applied uniformly
-- after either primary auth path succeeds (password via AuthService, Google
-- OAuth via OAuthRoutes) -- not replacing either.
--
-- Migration number: this is V89, not V88. Sibling ticket HEL-703's unmerged
-- branch had already claimed V88 (V88__user_tier.sql) at the time this
-- change was planned, even though this checkout's own migrations only go up
-- to V87. Using the next-free number in THIS checkout (V88) would collide
-- with that branch the moment both land; V89 is deliberately reserved ahead
-- of time so the eventual merge only needs to resolve code conflicts, never
-- renumber or re-order a migration (design.md D2).
--
-- No row-level security on any of the three tables below: all are read
-- pre-identity on the login path -- user_mfa/mfa_login_challenges are looked
-- up by user_id/token_hash BEFORE an AuthenticatedUser exists, exactly like
-- users/user_sessions (which also carry no RLS). MfaRepository uses the raw
-- Slick Database, never DbContext/withUserContext.

CREATE TABLE user_mfa (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret    TEXT NOT NULL,              -- Base32-encoded RFC 4226 secret
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_step BIGINT NOT NULL DEFAULT 0,  -- RFC 6238 replay guard
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at    TIMESTAMPTZ NULL
);

CREATE TABLE mfa_backup_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,   -- SHA-256 hex of the raw code, never the raw code
  used_at    TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_backup_codes_user_id ON mfa_backup_codes (user_id);

CREATE TABLE mfa_login_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, -- SHA-256 hex of the raw challenge token
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_mfa_login_challenges_user_id ON mfa_login_challenges (user_id);
