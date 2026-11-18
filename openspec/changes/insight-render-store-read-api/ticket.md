# HEL-1742: Insight L2: insight render store, read API and retention

## Description

Leaf of HEL-921 (narrative insight Outputs). It needs L1 (HEL-1740, merged). Rendered insight text needs its own
table: `node_snapshots` and the history summary can't hold text.

**What to build**

- **The `output_insights` table:**
  - Columns: `id`, `output_id` (FK, cascades on delete), `pipeline_id`, `run_id`, `trigger` (on_run | daily | manual |
    pin), `status` (ok | failed | skipped_quota | skipped_unchanged | skipped_budget), `markdown`, `citations` (jsonb),
    `input_digest`, `model`, token counts, `cost_micros`, `created_at`.
  - RLS uses `helio_can_access_pipeline(pipeline_id)`, as V115 does. Add an explicit grant to `helio_privileged`, and
    add the table to `RlsPolicyGuardSpec.rlsTables`.
- **Three endpoints:**
  - `GET /api/outputs/:id/insight` returns the latest good render plus the status of the last attempt.
  - `GET /api/outputs/:id/insight/history`.
  - Public `GET /api/dashboards/:d/panels/:p/insight` with allow-listed fields only: no cost, model, token or run-id
    fields.
- **Retention:** per tier, on the existing scheduler-tick retention pass.

## Acceptance Criteria

- A non-grantee gets the same 404 as an unknown id.
- The public route's schema test shows no cost, model or run-id fields.
- Deleting the Output cascades to its insight rows.
- Reads never regenerate a render. The read service has no model client wired in, by construction.
- **Live check:** run RLS as `helio_app`, the non-BYPASSRLS role, not as superuser (MISTAKES.md: RLS never runs in dev
  or CI).
- Update CLAUDE.md's endpoint list. Fix the stale "no route consumes ANTHROPIC_API_KEY" row too.

## Migration

The ticket text says V139. That is stale: main's max is V141 and Flyway has no outOfOrder. Driver ledger: this ticket
uses **V142** (V143 reserved HEL-1734, V144 reserved HEL-1739). Just before merge, if main's max is at or above 142,
renumber to max+1.

## Driver context (claims, verified at Planning)

- Epic draft: `.concertino/scratch/driver/hel921-leaves-draft.md`, owner rulings D1-D11. D1 amended: the per-Output
  `model` config key is L4 (HEL-1743). The `model` column on `output_insights` records which model rendered the row.
- This ticket makes no model calls.
- L1 follow-ups (a) insight panel footer "UPDATED <date>" + refresh button and (b) `InsightNotRenderedState` lacking
  `role="status"`: both out of scope here (see design.md Planner Notes), owned by L5 (HEL-1744).
