-- HEL-505 (design.md Decision 2): DB-backed, globally-consistent fixed-window rate-limit counter
-- for pipeline-run submissions -- one row per (user, window bucket), mirroring V88's
-- `assistant_daily_usage` shape exactly. `window_start` is the epoch truncated to the configured
-- window size, computed in application code (`PipelineRunGuardRepository`) and passed in as a
-- parameter -- each new window boundary naturally creates a fresh row via the `ON CONFLICT`
-- insert path, no in-statement reset logic needed.
--
-- Every access goes through `DbContext.withUserContext(user.id.value)` (design.md Decision 4) --
-- every one of the three existing trigger paths already has a real `user.id` in scope at the
-- `submit` call site, including the scheduler's synthetic owner-`AuthenticatedUser`, so (unlike
-- `users` itself) there is no pre-identity gap here. Gets full RLS, matching the direct-owner
-- pattern of `assistant_daily_usage` (V88) / `api_tokens` (V42) exactly.

CREATE TABLE pipeline_run_rate_window (
  user_id       UUID NOT NULL REFERENCES users(id),
  window_start  TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL,
  PRIMARY KEY (user_id, window_start)
);

ALTER TABLE pipeline_run_rate_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_run_rate_window FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_run_rate_window_owner ON pipeline_run_rate_window
  USING (user_id = current_setting('app.current_user_id')::uuid);
