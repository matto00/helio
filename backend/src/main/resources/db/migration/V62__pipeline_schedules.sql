-- HEL-414: Scheduled runs -- schedule model + persistence (data model + CRUD
-- only; the runtime that fires schedules is a sibling ticket, HEL-415).
--
-- pipeline_schedules is a 1:1 child of pipelines (pipeline_id UNIQUE FK,
-- ON DELETE CASCADE): the route is the singleton /api/pipelines/:id/schedule,
-- not /api/schedules/:id, so no client ever needs a schedule id independent
-- of its pipeline. The table still gets a synthetic `id TEXT PRIMARY KEY`
-- (consistent with every other table's id-as-PK convention), but repository
-- lookups key on pipeline_id.
--
-- kind/expression hold either a 5-field cron string or an interval token
-- (`<n><unit>`); validated structurally at the service layer (hand-rolled,
-- no new dependency -- see design.md Decision 5). next_run_at/last_run_at
-- are persisted as nullable columns but NOT computed by this ticket -- that
-- requires real next-fire-time semantics (timezone-aware, DST-aware) owned
-- entirely by HEL-415's poller.
--
-- RLS mirrors the indirect-owner pattern (V35's pipeline_steps_owner /
-- pipeline_runs_owner): no owner_id column of its own -- the USING clause
-- joins to pipelines.owner_id. The UNIQUE constraint on pipeline_id already
-- creates a supporting index, so no additional index is needed.

CREATE TABLE pipeline_schedules (
    id           TEXT PRIMARY KEY,
    pipeline_id  TEXT NOT NULL UNIQUE REFERENCES pipelines(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('cron', 'interval')),
    expression   TEXT NOT NULL,
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    timezone     TEXT NOT NULL,
    next_run_at  TIMESTAMPTZ,
    last_run_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS: mirror the V35 indirect-owner pattern exactly ───────────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table --
-- without FORCE, the table owner would bypass RLS even on the app pool. The
-- privileged pool (helio_privileged, BYPASSRLS -- see V34) is the only
-- sanctioned bypass, reserved for future privileged callers (e.g. HEL-415's
-- poller, which has no request-bound user).

ALTER TABLE pipeline_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_schedules_owner ON pipeline_schedules
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_schedules.pipeline_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );
