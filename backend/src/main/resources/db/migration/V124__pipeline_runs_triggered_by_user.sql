-- HEL-1492: attribute every newly written pipeline run to the user who submitted it. An editor grantee's run
-- is now recorded on the pipeline OWNER's history, so the row needs to say who actually triggered it
-- (triggered_by_token_id only covers PAT-authenticated external triggers).
--
-- Additive and nullable, no default and NO backfill / data UPDATE: existing rows stay NULL ("not recorded"),
-- and an UPDATE on this FORCE-RLS table under Flyway's non-BYPASSRLS role is the v0.7.x incident class.
-- ON DELETE SET NULL: deleting a user keeps the owner's run history (FK actions bypass RLS).
ALTER TABLE pipeline_runs
  ADD COLUMN triggered_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;
