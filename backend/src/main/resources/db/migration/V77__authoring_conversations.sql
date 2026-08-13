-- HEL-397: Authoring conversation state (multi-turn NL dashboard authoring, refining a
-- DashboardProposal before it's ever applied).
--
-- authoring_conversations is a direct-owner table, mirroring V75__metrics.sql's RLS pattern
-- exactly. Two separate JSONB turn representations, not one (design.md D3): api_history (the raw
-- Vector[ClaudeMessage] shape needed to continue the Claude conversation -- NEVER exposed via the
-- API) and display_turns (Vector[{role,text}], human-readable -- the ONLY turn representation
-- GET /api/authoring/conversations/:id returns). latest_proposal is the current working
-- DashboardProposal snapshot -- what "review & apply" hands off. total_tokens_used accumulates
-- real ClaudeResponse.usage (never the pre-flight estimate) for the per-conversation token
-- ceiling (design.md D5), distinct from ClaudeClient's own per-request guardrail.
--
-- A row is only ever created once a turn SUCCEEDS (parses + validates, possibly after one repair
-- round-trip) -- there is nothing worth persisting for a call that never produces a proposal, so
-- latest_proposal is nullable but always populated in practice by the time a row exists.

CREATE TABLE authoring_conversations (
    id                  TEXT PRIMARY KEY,
    owner_id            UUID NOT NULL REFERENCES users(id),
    api_history         JSONB NOT NULL,
    display_turns       JSONB NOT NULL,
    latest_proposal     JSONB,
    total_tokens_used   INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_authoring_conversations_owner_id ON authoring_conversations(owner_id);

-- ── RLS: mirror the V75 direct-owner pattern exactly ─────────────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table -- without FORCE, the
-- table owner would bypass RLS even on the app pool. The privileged pool (helio_privileged,
-- BYPASSRLS -- see V34) is the only sanctioned bypass.

ALTER TABLE authoring_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE authoring_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY authoring_conversations_owner ON authoring_conversations
  USING (owner_id = current_setting('app.current_user_id')::uuid);
