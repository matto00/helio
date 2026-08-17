-- HEL-704: invite_codes — single-use, recipient-bound Beta-access codes (design.md D1).
--
-- Migration number V90, deliberately skipping V89 -- V89 is claimed by in-flight sibling
-- HEL-702 (TOTP MFA) on its own unmerged branch, so it is not visible in this checkout, but
-- reusing it here would collide the moment that branch merges.
--
-- id has no DEFAULT (minted app-side / by the owner's issuance script -- house style, mirrors
-- panels/dashboards/pipelines). code_hash is the sha256 hex digest of the plaintext code (D2 --
-- TokenHashing.sha256Hex on redemption, Postgres sha256() at issuance via
-- backend/scripts/issue-invite-code.sql); the plaintext itself is NEVER persisted anywhere.
-- user_id is the code's intended recipient -- direct-owner RLS pattern, mirrors
-- assistant_conversations (V80). redeemed_at NULL means unredeemed; it is set exactly once, by
-- InviteCodeRepository.redeemAndUpgrade's conditional `UPDATE ... WHERE redeemed_at IS NULL`
-- (D3), which makes concurrent redemption of the same code race-free.

CREATE TABLE invite_codes (
    id          UUID PRIMARY KEY,
    code_hash   TEXT NOT NULL UNIQUE,
    user_id     UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL,
    redeemed_at TIMESTAMPTZ NULL
);

-- Serves both the RLS policy predicate below and any owner-scoped lookup (e.g. "does this user
-- have an outstanding code").
CREATE INDEX idx_invite_codes_user_id ON invite_codes(user_id);

-- ── RLS: direct-owner pattern, mirrors V80 (assistant_conversations) exactly ─────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table -- without FORCE, the
-- table owner would bypass RLS even on the app pool. The privileged pool (helio_privileged,
-- BYPASSRLS -- see V34) is the only sanctioned bypass, which is exactly why
-- backend/scripts/issue-invite-code.sql must run as a BYPASSRLS role: it inserts a row on
-- behalf of a user other than whichever role is running the script.

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY invite_codes_owner ON invite_codes
  USING (user_id = current_setting('app.current_user_id')::uuid);
