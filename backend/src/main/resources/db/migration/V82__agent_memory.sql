-- HEL-478 (420-B, Agent Memory & Preferences): the persisted, free-form MEMORY store the in-app
-- agent writes learned facts/goals/preference-notes to (kind: fact/goal/preference-note),
-- distinct from the structured, single-row-per-user AgentPreferences store (420-A, V81).
--
-- Multi-row-per-owner (like api_tokens, V42), not a single JSONB row per user (unlike
-- agent_preferences) -- see design.md Decision 1. kind is TEXT, not a DB-level enum/check
-- constraint -- the closed allow-list (fact/goal/preference-note) is enforced at the domain
-- boundary via AgentMemoryKind.fromString, mirroring ScheduleKind's existing precedent of
-- keeping enum validation in Scala, not Postgres.
--
-- No DEFAULT on id -- AgentMemoryService always generates it in Scala before insert, mirroring
-- ApiTokenService.create's id = ApiTokenId(UUID.randomUUID().toString) pattern.

CREATE TABLE agent_memory (
    id           UUID PRIMARY KEY,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    content      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

-- Covers the owner-only policy predicate (V37 pattern).
CREATE INDEX idx_agent_memory_owner_id ON agent_memory (owner_id);

-- Composite index supporting the cap-and-evict query's ORDER BY without a full-table sort on
-- every insert (design.md Decision 2).
CREATE INDEX idx_agent_memory_owner_created ON agent_memory (owner_id, created_at);

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;

-- Owner-only: no separate WITH CHECK -- the USING expression alone also gates INSERT, so a user
-- cannot write a row for another owner_id (V42/V54/V81 pattern).
CREATE POLICY agent_memory_owner ON agent_memory
  USING (owner_id = current_setting('app.current_user_id')::uuid);
