# HEL-873: Persisted run history carries no truncation signal — a reloaded page shows a capped row count with nothing to distrust it

## Description

Spun off from HEL-861 by its evaluation gate (evaluation-1.md, non-blocking suggestion 5), verified against a live 3,303-row Sleeper source.

### What HEL-861 fixed

HEL-861 made row-cap truncation honest **in the run result**: `sourceTruncated`, `sourceAvailableRowCount`, `truncatedReads` and a server-composed `truncationNotice` now flow to the API, the MCP surface and a warning banner on the pipeline detail page.

### What it did not fix

The truncation signal lives in Redux **run state**, not in persisted run history. So:

* Run a truncated pipeline -> the banner correctly warns that only 1000 of 3303 rows were read.
* **Reload the page** -> the banner is gone. The footer shows `Rows written: 1,000` with no indication that the number is partial.

The persisted run record has no truncation column, so nothing can be rendered after the session that produced it.

### Why it matters

A truncation signal that is absent is indistinguishable from "nothing was truncated". If persisted history cannot express truncation, every historical run silently reads as complete, and an agent or human reasoning over that history draws confident conclusions from partial data. A reloaded page showing `1,000` is exactly a plausible-looking number with no signal to distrust it — and it is the state a user or agent encounters *most* of the time, since a run is looked at long after it happened far more often than at the moment it completes.

## Verified premise (probe, 2026-09-06)

Confirmed against the live tree before planning:

* `PipelineRunService.truncationFields` (PipelineRunService.scala:120-141) computes `(sourceTruncated, sourceAvailableRowCount, truncationNotice, truncatedReads)` and spreads them straight into `RunResultResponse` at the run call site (PipelineRunService.scala:898-905). Nothing else consumes them.
* No migration defines any truncation column. Persistence sites are the `pipeline_runs` history table (V24 + V63/V74/V84: `row_count`, `status`, `trigger_source`, `error_log`) and the denormalised `pipelines.last_run_row_count` (V30). **There are two persistence sites, not one** — the ticket text understates this.
* `GET /api/pipelines/:id/run-history` -> `PipelineRunRecord` (PipelineProtocol.scala:156-167) and `GET /api/pipelines` -> `PipelineSummaryResponse` (PipelineProtocol.scala:100-116) both carry `rowCount`/`lastRunRowCount` with no truncation field.
* The banner is Redux-only session state (pipelinesSlice.ts:100-103, initialised false/null at :147-149, reset at :382-384) and is therefore gone after reload.

## Constraints

* **Migration number:** derive from the tree at the moment of writing. Main is at V102; the concurrent HEL-955 worktree already claims `V103__pending_connectors.sql`, so this change must take **V104 or later**. Never edit an applied migration — Flyway checksums the whole file including comments, and every worktree on this machine shares one `flyway_schema_history`.
* **Do not touch** `ApiRoutes.scala`, `ConnectorEntityProtocol`, `RestApiConnectorDriver`, `Connector.scala`, `ConnectorRepository`, `helio-mcp/src/types.ts`, `helio-mcp/src/helioApi.ts` (owned by concurrent HEL-955), nor `frontend/src/shared/chrome/**` or `DashboardList.css` (owned by concurrent HEL-1003). `PipelineRunHistoryRoutes.scala` is free.
* Reuse HEL-861's existing server-composed notice wording; do not invent a second phrasing.
* Follow HEL-890's established convention: **present-and-empty beats absent** for collection-valued truncation detail.
* A persisted record that predates the new field means "no signal recorded", which is **not** the same as "not truncated". `design.md` must state explicitly how the two are distinguished, or state plainly that they cannot be and why that is acceptable.
* Binding: `CONTRIBUTING.md` (no inline fully-qualified names in Scala), `CLAUDE.md` (keep `schemas/` and `openspec/` in the same change), `DESIGN.md` for frontend work.

## Acceptance criteria

- [ ] A truncated run's row count is still identifiable as partial after a page reload.
- [ ] The signal survives in the persisted run record, not only in session state.
- [ ] A run under the cap shows no truncation indication (no false positives), including historically.
- [ ] Wherever a persisted row count is displayed, a truncated count is visually distinguishable from a complete one.
- [ ] Schemas/openspec updated in the same change, per CLAUDE.md.
