-- HEL-411: conversational refinement shares the HEL-397 `authoring_conversations` store
-- (design.md D3) rather than a parallel table -- a conversation's persisted outcome is EITHER an
-- authoring `latest_proposal` OR a refinement `latest_patch_set`, never both.
--
-- `latest_patch_set` mirrors `latest_proposal` exactly: nullable JSONB, populated only once a
-- refinement turn has already parsed + validated (see V77__authoring_conversations.sql's own
-- comment for the identical "row only created on success" invariant, which applies unchanged to
-- this column too).
--
-- The inline CHECK is a DB-level backstop for mutual exclusivity, not a substitute for
-- application discipline (`RefinementConversationTurns`/`AuthoringConversationTurns` each populate
-- only their own column) -- follows this codebase's own established convention of a CHECK for
-- exactly this class of invariant: `V23__pipeline_steps.sql`'s `op` enum, `V62__pipeline_schedules.sql`'s
-- `kind` enum, `V73__add_resource_tag.sql`'s length check. A Postgres column-level CHECK may
-- reference other columns of the same row (it's a row constraint regardless of where declared), so
-- this single inline clause is equivalent to a separate table-level constraint.

ALTER TABLE authoring_conversations
    ADD COLUMN latest_patch_set JSONB CHECK (latest_proposal IS NULL OR latest_patch_set IS NULL);
