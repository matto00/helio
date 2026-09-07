-- HEL-955: pending-connector handoff (openspec/changes/pending-connector-handoff).
--
-- 1. `connectors.credential_id` becomes nullable -- a Connector can now be created WITHOUT a
--    credential row ("pending"), for an agent-authored Connector whose credential a human must
--    supply out-of-band (design.md D1). `Option[ConnectorCredentialId]`/`isPending` on the domain
--    side mirror this at compile time -- see `Connector.scala`. A no-auth Connector still gets a
--    real credential row holding an encrypted empty string (`ImplicitConnectorConfig`) -- pending
--    means genuinely no row, never conflated with `authType: "none"`.
ALTER TABLE connectors ALTER COLUMN credential_id DROP NOT NULL;

-- design.md D10: owner-visible completion signal, stored independently of
-- `connector_completion_tokens.consumed_at` (that row is cascaded on delete of the token, and a
-- bare timestamp alone cannot distinguish "my teammate finished it" from "someone who merely
-- read the transcript finished it"). `completed_by` records the authenticated principal, or the
-- literal string `anonymous` for an out-of-band completion with no session.
ALTER TABLE connectors ADD COLUMN completed_at TIMESTAMPTZ NULL;
ALTER TABLE connectors ADD COLUMN completed_by TEXT NULL;

-- 2. Completion tokens -- mirrors `share_tokens` (V101) almost exactly (design.md D2), with two
--    deliberate divergences, both tightening: `expires_at NOT NULL` (never an unbounded slot) and
--    single-use CONSUMPTION replacing revocation. Two distinct invalidation columns for two
--    distinct events (design.md D9): `consumed_at` = successfully used to bind a credential;
--    `superseded_at` = a newer token was minted for the same Connector (re-mint). A token is valid
--    only when BOTH are NULL and it has not expired -- see `ConnectorCompletionTokenRepository`'s
--    conditional UPDATE, which is the actual enforcement point (every validity condition must live
--    in that predicate, not only in the in-memory validator).
CREATE TABLE connector_completion_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id  UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index on the hash: lookup key for the anonymous completion validation path.
CREATE UNIQUE INDEX idx_connector_completion_tokens_token_hash ON connector_completion_tokens (token_hash);

-- Covers the owner-facing re-mint superseding pass (every currently-live token for a Connector).
CREATE INDEX idx_connector_completion_tokens_connector_id ON connector_completion_tokens (connector_id);

ALTER TABLE connector_completion_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_completion_tokens FORCE ROW LEVEL SECURITY;

-- Owner-only, mirrors `share_tokens_owner` (V101) exactly -- no WITH CHECK clause, so the USING
-- expression also gates INSERT (a user cannot mint a completion token attributed to another
-- user_id).
CREATE POLICY connector_completion_tokens_owner ON connector_completion_tokens
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- The anonymous completion lookup/consume (`findByHash`/`consume`) reads and writes through the
-- privileged pool (`ctx.withSystemContext`) since there is no `app.current_user_id` to set for an
-- unauthenticated caller -- explicit grant, mirroring V102's rationale (V38's default-privilege
-- grant most likely already covers this, but this repo has had prod-only RLS/grant incidents that
-- local/CI/prod-dump testing as a superuser cannot catch).
GRANT SELECT, UPDATE ON connector_completion_tokens TO helio_privileged;
