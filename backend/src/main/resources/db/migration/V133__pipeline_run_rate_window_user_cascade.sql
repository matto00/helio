-- HEL-1440: `pipeline_run_rate_window.user_id` cascades on user delete.
--
-- V109 created the column as a plain `REFERENCES users(id)` (NO ACTION), so a user with a rate-window row could not be
-- deleted: the row blocked the delete. A rate-window row is per-user rate-limit bookkeeping, not user content, so it
-- goes with its user (mirrors `product_events.user_id`). Every other blocking reference is unchanged.
--
-- Existing rows all satisfied the old FK, so the validating ADD is safe (no NOT VALID).
--
-- RLS (the reason for the bracket): prod's Flyway role `helio` is the table owner but NOSUPERUSER NOBYPASSRLS, and its
-- connection never sets `app.current_user_id`. The table has FORCE ROW LEVEL SECURITY and a bare `current_setting`
-- policy, and the FK-validation scan of ADD CONSTRAINT is subject to it: with any row present it raises 42704
-- (observed in V133RateWindowCascadeMigrationSpec, which runs this as that role). So FORCE is lifted for the
-- constraint swap and restored in the same transaction. Do not set app.current_user_id here.
-- The later RI cascade DELETE runs without RLS, so it needs nothing. The user-reference inventory:
-- docs/user-reference-inventory.md.

ALTER TABLE pipeline_run_rate_window NO FORCE ROW LEVEL SECURITY;

ALTER TABLE pipeline_run_rate_window
  DROP CONSTRAINT pipeline_run_rate_window_user_id_fkey,
  ADD CONSTRAINT pipeline_run_rate_window_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE pipeline_run_rate_window FORCE ROW LEVEL SECURITY;
