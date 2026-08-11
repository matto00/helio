## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Diff vs. ticket/design read directly**: `git diff main...HEAD --stat` (34 files, +1764/-107).
   Read the full diffs of `V76__panel_metric_id.sql`, `MetricPanel.scala`/`ChartPanel.scala`/
   `TablePanel.scala`/`package.scala`, `PanelService.scala`, `PanelServiceHelpers.scala`,
   `PanelRepository.scala`, `PanelRowMapper.scala`, `MetricRepository.scala`, `ApiRoutes.scala`,
   `PanelRoutes.scala`, `schemas/panel.schema.json`. All match design.md's D1–D5 decisions exactly
   (per-subtype `metricId: Option[MetricId]`, jsonFormat arity bump, absent-vs-null Patch semantics,
   nullable FK column `ON DELETE SET NULL` + index, D3's independent metricId-only clearing vs. D2's
   pre-existing whole-binding dataTypeId clearing, D4's MetricPanel-only materialization formula, D5's
   400 `rejectUnresolvableMetric` wired into both `create`/`update`).

2. **Migration number correctness**: confirmed `ls backend/.../db/migration/ | sort -V | tail` shows
   `V75__metrics.sql` then `V76__panel_metric_id.sql` — no collision, matches design.md's stated
   verification requirement.

3. **Full backend test suite, re-run fresh (not trusted from evaluator's report)**:
   `sbt test` → `Total number of tests run: 2434 ... succeeded 2434, failed 0`. Matches evaluation-1.md's
   claim, independently reproduced. Also ran the four HEL-500-specific spec files directly
   (`PanelServiceMetricBindingSpec`, `PanelSpec`, `PanelMetricBindingRoutesSpec`, `MetricRepositorySpec`)
   — 220/220 green.

4. **Schema/format/quality gates, re-run fresh**: `npm run check:schemas` → clean (35 protocols, 29
   files, panel-type enums in sync). `npm run check:scala-quality` → clean (84 pre-existing soft
   file-size warnings only, informational per CONTRIBUTING.md). `npm run format:check` → clean.

5. **No inline FQNs**: `git diff main...HEAD -- 'backend/src/main/**/*.scala' | grep '^\+' | grep 'com\.helio\.'`
   returns only `import` lines (4 total) — no inline fully-qualified names introduced.

6. **~10 `PanelService` constructor call sites**: `grep -rln "new PanelService("` → 9 files (1 main +
   8 test), 13 total call sites. Inspected every one — all correctly pass a `MetricRepository`
   (mocked, or wired) as the new trailing constructor param. Compiles clean (confirmed by the green
   test run, which would fail to compile otherwise).

7. **AC1 (materialization) / AC4 (precedence)**: `PanelMetricBindingRoutesSpec` exercises both against
   a real embedded-Postgres DB via `GET /api/dashboards/:id/panels` (the `resolveBindingsForRead`
   batch path) — metric-only panel materializes `dataTypeId`/`fieldMapping`/`aggregation`/`unit`
   correctly; an explicit raw `fieldMapping` override wins over the metric-derived value.

8. **AC2 (deleted-metric unbind) / AC3 (cross-user rejection + read-time clear)**: same spec file —
   `DELETE /api/metrics/:id` via the real FK leaves the panel intact with `metricId` cleared on next
   read; a stored foreign `metricId` (simulated via direct repo insert, bypassing create-time
   validation, exactly matching D3's stated defense-in-depth scenario) clears independently, leaving
   the raw `dataTypeId` untouched. `PanelServiceMetricBindingSpec` covers the create/update-time 400
   rejection (foreign, nonexistent, non-pipeline-output-bound metric) with mocked repos.

9. **Gap found and independently closed via live verification — the `/query` route's single-panel
   materialization path (`resolveSingleBinding`, tasks.md 5.3, explicitly flagged by the executor as
   fixing a previously-unresolved read path) had ZERO test coverage and was NOT exercised by the
   evaluator's live smoke test either** (evaluation-1.md's live check only hit
   `GET /api/dashboards/:id/panels`, the batch `resolveBindingsForRead` path — a genuinely different
   code path from `resolveSingleBinding`, which is used by `update`'s post-patch resolve and by
   `PanelRoutes`'s `/query` route). I started the servers
   (`scripts/concertino/start-servers.sh` → both already healthy; `assert-phase.sh servers` → `PASS`),
   logged in as `matt@helio.dev`, created a pipeline-output-bound `MetricDefinition`
   (`measureField: "amount"`, `aggregation: "sum"`), created a `MetricPanel` with only `config.metricId`
   set, and hit `GET /api/panels/:id/query` directly:
   - With `metricId` set → `{"selectedFields": ["amount"], ...}` — confirms `resolveSingleBinding`'s
     materialization *did* run before `Panel.buildQuery` executed (the panel's own `dataTypeId`/
     `fieldMapping` were empty; `selectedFields` could only derive from the metric-resolved
     `fieldMapping = {"value": "amount"}`).
   - Negative control, a metric panel with no binding at all → `GET /query` returned
     `{"message": "Panel is not bound to a data type"}` — confirms the positive result above is not a
     coincidence of some other default.
   Cleaned up all test data afterward (panel/dashboard/metric all `DELETE` → 204). This closes the one
   real verification gap I found; the code is correct, it was simply unverified by anyone before this
   review. Flagging as a **non-blocking process note**, not a change request, since the actual behavior
   is correct.

10. **Scope check**: `git diff main...HEAD --stat -- frontend/` → empty; zero frontend files touched,
    consistent with the ticket's explicit non-goals (authoring UI / workspace-context are 418-F/418-E,
    out of scope). No UI judgment required for this gate.

11. **D4 scope-narrowing defensibility**: re-read design.md's justification (Chart's axis-keyed
    `{xAxis,yAxis,series?}` mapping and Table's arbitrary column-key mapping have no unambiguous single
    slot for a metric's one `measureField`) and confirmed this was already adversarially reviewed and
    confirmed at the design gate (`skeptic-design-2.md` line 68: `Verdict: CONFIRM`, explicitly
    addressing D4). The ticket's own scope bullet uses hedged language ("at minimum", "where the epic
    warrants") that supports this narrowing for schema/validation without a resolution guarantee.

12. **Byte-for-byte pre-existing-panel behavior**: additive nullable column, `metricId` is `None` by
    construction for any panel that never carries it (D2), and every materialization branch is gated on
    `metricIdOf(panel)` returning `Some` — code-level confirmation, plus the full regression suite
    (2434/2434) passing is the practical proof no existing behavior shifted.

### Verdict: CONFIRM

All five ACs trace to real, independently-reproduced evidence (tests I re-ran myself, plus a live
end-to-end check of the one path that had no coverage anywhere). No scope creep, no placeholder/TODO
code, no FQN violations, no schema drift, D4's scope-narrowing is sound and was already vetted at
design time. Ships.

### Non-blocking notes

- The `/query` route's single-panel materialization path (`resolveSingleBinding`, used by `update` and
  `PanelRoutes`'s `/query`) has no automated test and wasn't hit by the evaluator's live smoke test
  either — only the batch `resolveBindingsForRead` path (`GET /dashboards/:id/panels`) is covered. I
  verified it live and it works correctly, but a future regression here would only be caught by
  `resolveBindingsForRead`'s tests, not this path's own. Worth a follow-up test
  (`PanelMetricBindingRoutesSpec` already has the fixture scaffolding to add a `GET /api/panels/:id/query`
  case cheaply) rather than relying on the shared-helper-function argument for safety.
- `metricIdFromCreateConfig` (unlike `dataTypeIdFromCreateConfig`) does not filter an explicit empty-string
  `metricId: ""` before validation — an empty string will 400 via `rejectUnresolvableMetric` rather than
  being silently treated as unset. This is actually more defensive than the `dataTypeId` precedent, not a
  bug, but worth knowing if a future ticket tries to make the two helpers byte-for-byte symmetric.
- `PanelService.scala` (538 lines) / `PanelServiceHelpers.scala` (348 lines) are both over the
  ~250-line soft budget (pre-existing before this ticket, grown further by it) — informational only,
  already flagged by the evaluator.
