-- HEL-412: persisted disable/enable for pipeline steps.
--
-- `enabled` defaults true so every existing row (and every pipeline run/
-- analyze/preview path that doesn't yet know about the flag) behaves
-- identically to today. See design.md Decision 1 — the number is
-- coordinator-confirmed: origin/main HEAD is V84, and the parallel HEL-462
-- lane has claimed V85 for its `last_source_schema` migration on the same
-- shared dev Postgres, so this change takes V86.

ALTER TABLE pipeline_steps ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
