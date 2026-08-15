-- HEL-663: Persistent, listable, pin-able top-level-assistant conversations (HEL-659's assistant —
-- a Chat nav destination, HEL-664+, needs somewhere to list conversations from and a transcript to
-- load).
--
-- assistant_conversations is a direct-owner table, mirroring V77__authoring_conversations.sql's RLS
-- pattern exactly. Unlike authoring_conversations (which stores its full transcript as
-- api_history JSONB in Postgres), this table is a SLIM metadata row only -- the transcript body
-- (Seq[ClaudeToolMessage], design.md D2) is stored via the existing FileSystem abstraction
-- (local-or-GCS, selected by HELIO_UPLOADS_BACKEND) at
-- assistant-conversations/{userId}/{conversationId}.json, referenced here by gcs_body_ref. title is
-- NOT NULL -- AssistantConversationService.create always supplies one, defaulting to the literal
-- "New conversation" when neither an explicit title nor a derivable first message is supplied
-- (design.md D6). pinned + the composite index below directly serve the list endpoint's
-- `ORDER BY pinned DESC, updated_at DESC` (design.md D1/D5) -- the "top 10 unless pinned" default
-- view is a display-time LIMIT only; no row is ever hidden/archived/deleted by this ticket
-- (design.md D4).

CREATE TABLE assistant_conversations (
    id            TEXT PRIMARY KEY,
    owner_id      UUID NOT NULL REFERENCES users(id),
    title         TEXT NOT NULL,
    pinned        BOOLEAN NOT NULL DEFAULT FALSE,
    gcs_body_ref  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assistant_conversations_owner_id ON assistant_conversations(owner_id);

-- Directly serves the list query's ORDER BY pinned DESC, updated_at DESC per owner (design.md D1) --
-- a new index, not a reuse, since no existing table has this exact ordering need.
CREATE INDEX idx_assistant_conversations_owner_pinned_updated
  ON assistant_conversations(owner_id, pinned DESC, updated_at DESC);

-- ── RLS: mirror the V77 direct-owner pattern exactly ─────────────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table -- without FORCE, the
-- table owner would bypass RLS even on the app pool. The privileged pool (helio_privileged,
-- BYPASSRLS -- see V34) is the only sanctioned bypass.

ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY assistant_conversations_owner ON assistant_conversations
  USING (owner_id = current_setting('app.current_user_id')::uuid);
