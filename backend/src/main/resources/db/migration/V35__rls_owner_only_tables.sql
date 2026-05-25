-- HEL-275: Enable Row Level Security on the six owner-only tables.
--
-- Two pools exist (see DbContext):
--   * App pool (DB_USER without helio_privileged): RLS policies evaluate
--     against current_setting('app.current_user_id'), set by withUserContext.
--   * Privileged pool (SET ROLE helio_privileged BYPASSRLS): policies are
--     skipped entirely; withSystemContext callers see all rows.
--
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the tables.
-- Without FORCE, the table owner bypasses RLS even on the app pool.
--
-- Direct-owner tables (pipelines, data_sources, data_types):
--   Policy USING clause compares owner_id to the session variable cast to UUID.
--   If app.current_user_id is not set the cast raises an error, making the
--   app pool fail-closed rather than silently leaking data.
--
-- Indirect-owner tables (pipeline_steps, pipeline_runs, data_type_rows):
--   Policy uses an EXISTS subquery to the parent table's owner_id. The parent
--   table also has RLS, but the privileged pool bypasses both, so background
--   engine paths (withSystemContext) continue to work correctly.
--
-- Existing indexes from HEL-265 V17 (idx_pipelines_owner_id,
-- idx_data_sources_owner_id, idx_data_types_owner_id) cover the policy
-- predicates on direct-owner tables -- no new indexes needed.

-- ── pipelines (direct owner_id) ─────────────────────────────────────────────

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;

CREATE POLICY pipelines_owner ON pipelines
  USING (owner_id = current_setting('app.current_user_id')::uuid);

-- ── data_sources (direct owner_id, nullable) ─────────────────────────────────
-- owner_id is NULLABLE (V14). NULL rows evaluate the USING clause to NULL
-- which Postgres treats as false -- they are excluded from app-pool queries.
-- This is the correct posture: rows without an owner are invisible to users
-- and still accessible via the privileged pool.

ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY data_sources_owner ON data_sources
  USING (owner_id = current_setting('app.current_user_id')::uuid);

-- ── data_types (direct owner_id, nullable) ───────────────────────────────────

ALTER TABLE data_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_types FORCE ROW LEVEL SECURITY;

CREATE POLICY data_types_owner ON data_types
  USING (owner_id = current_setting('app.current_user_id')::uuid);

-- ── pipeline_steps (indirect via pipelines.owner_id) ────────────────────────
-- pipeline_steps has no owner_id column; ACL is inherited from the parent
-- pipeline. The EXISTS subquery joins to pipelines which also has RLS, but
-- on the privileged pool both policies are bypassed -- withSystemContext
-- callers see all steps regardless.

ALTER TABLE pipeline_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_steps FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_steps_owner ON pipeline_steps
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_steps.pipeline_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );

-- ── pipeline_runs (indirect via pipelines.owner_id) ─────────────────────────

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_runs_owner ON pipeline_runs
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_runs.pipeline_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );

-- ── data_type_rows (indirect via data_types.owner_id) ───────────────────────
-- data_type_rows is always written/read via withSystemContext (background
-- pipeline engine path). The privileged pool bypasses this policy. The policy
-- is still enabled so that any future non-privileged path is fail-closed by
-- default rather than silently open.

ALTER TABLE data_type_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_type_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY data_type_rows_owner ON data_type_rows
  USING (
    EXISTS (
      SELECT 1 FROM data_types dt
      WHERE dt.id = data_type_rows.data_type_id
        AND dt.owner_id = current_setting('app.current_user_id')::uuid
    )
  );
