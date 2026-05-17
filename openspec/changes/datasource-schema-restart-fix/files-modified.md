# Files Modified — HEL-256 cycles 1, 1b, 2

## Cycle 1 (prior commit)

Investigation-only — no production source files modified.

- `openspec/changes/datasource-schema-restart-fix/proposal.md` — investigation
  proposal (cycle 1 is no-code, cycle 2 will implement)
- `openspec/changes/datasource-schema-restart-fix/design.md` — investigation
  strategy + architectural confirmation of the schema display path
- `openspec/changes/datasource-schema-restart-fix/tasks.md` — cycle 1 task
  checklist (all complete) and cycle 2 placeholder
- `openspec/changes/datasource-schema-restart-fix/executor-report-1.md` —
  reproduction recipe (could not reproduce literal restart bug), dev-DB
  forensic findings, refutation of the six pre-recorded candidates,
  identification of a seventh candidate, fix design (~70 LoC across 3
  fixes), regression test plan, risks

## Cycle 1b (prior commit)

Investigation-only — no production source files modified.

- `openspec/changes/datasource-schema-restart-fix/executor-report-1.md` —
  appended "Cycle 1b — Continued investigation" section: 12-trigger
  matrix on a fresh CSV upload, **reproduced** the symptom (Trigger 12:
  `DELETE /api/types/:id` on a source's auto-inferred DT), updated fix
  design (Fix B′ promoted to PRIMARY; Fix D added for refresh upsert;
  A retained; C expanded to C′ with recovery affordance), 3 spinoffs
  identified
- `openspec/changes/datasource-schema-restart-fix/design.md` — added
  cycle-1b root-cause summary, updated fix design surface, recorded
  cycle-1b backend-cache / FileSystem observations, listed spinoffs
- `openspec/changes/datasource-schema-restart-fix/tasks.md` — added
  cycle-1b investigation checklist and rewrote cycle-2 task list
  around the four-fix surface (B′ + D + A + C′)
- `openspec/changes/datasource-schema-restart-fix/files-modified.md`
  — appended cycle-1b section

## Cycle 2 (this commit)

### Backend production

- `backend/src/main/scala/com/helio/services/DataTypeService.scala` —
  **Fix B′**: thread `dataSourceRepo` constructor dep; `delete` now
  rejects with `ServiceError.Conflict` when the DataType's `sourceId`
  points to a still-existing data source. Message names the source
  and steers the user toward `Refresh source` (Fix D) or delete-source
  flows.
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` —
  **Fix D**: extract a shared `upsertSourceDataType` helper used by
  `applyStaticRefresh` and `refreshCsv`; refresh re-creates the linked
  DT row when missing (instead of the pre-fix silent no-op). CSV
  refresh now maps `NoSuchFileException` to an actionable
  `ServiceError.BadRequest("…re-upload")`.
- `backend/src/main/scala/com/helio/app/SourceSchemaHealthCheck.scala`
  (new) — **Fix A**: boot-time `LEFT JOIN` query for `data_sources`
  rows missing a linked `data_types` row. Logs WARN per orphan with
  source id / name / owner / kind and a `POST /api/data-sources/:id/refresh`
  recovery hint.
- `backend/src/main/scala/com/helio/app/Main.scala` — invoke
  `SourceSchemaHealthCheck.run` after `DemoData.seedIfEmpty` so the
  warning fires on every boot.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — thread
  `dataSourceRepo` into the `DataTypeService` constructor (Fix B′
  wiring).

### Backend tests

- `backend/src/test/scala/com/helio/services/DataTypeServiceSpec.scala`
  (new) — covers the Fix B′ guard: conflict on source-linked delete,
  unblocked on no-link, unblocked on cascade-orphan (sourceId NULL).
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala`
  (new) — Fix D coverage: refresh updates the existing DT when
  present, re-creates when missing (CSV + Static), surfaces
  `BadRequest` on missing CSV file.
- `backend/src/test/scala/com/helio/services/DataSourceServiceRestartPersistenceSpec.scala`
  (new) — ticket AC #2: CSV + Static + SQL DataTypes all survive a
  service-layer "restart" (fresh repos / service against the same
  embedded Postgres).
- `backend/src/test/scala/com/helio/app/SourceSchemaHealthCheckSpec.scala`
  (new) — orphan-detection query coverage: empty when healthy, returns
  rows for unlinked sources, ignores pipeline-output DTs.
- `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` —
  updated to instantiate `DataTypeService` with the new
  `dataSourceRepo` constructor argument.

### Frontend production

- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` —
  **Fix C′**: when `relatedType` is missing or has zero fields, render
  `<EmptySchemaAffordance>` instead of silently omitting the schema
  section. Otherwise unchanged.
- `frontend/src/features/sources/ui/EmptySchemaAffordance.tsx` (new) —
  small sibling component: "Schema not available" headline, "Refresh
  source" button (dispatches `refreshSource(...)` + `fetchDataTypes`),
  fallback "Delete and re-upload" action. Surfaces refresh errors
  inline (e.g. the CSV-file-missing BadRequest from Fix D).
- `frontend/src/features/sources/ui/SourceDetailPanel.css` — styles for
  the dashed-border empty-schema box + inline action row.

### Frontend tests

- `frontend/src/features/sources/ui/SourceDetailPanel.test.tsx` (new) —
  4 cases: schema table renders when DT present, affordance renders
  when DT missing, Refresh dispatches `refreshSource` + `fetchDataTypes`,
  error path surfaces refresh failure as an alert.

### Change folder

- `openspec/changes/datasource-schema-restart-fix/tasks.md` — marked
  cycle-2 tasks complete; left optional Playwright step open.
- `openspec/changes/datasource-schema-restart-fix/workflow-state.md` —
  bumped `CYCLE: 1` → `CYCLE: 2`.
- `openspec/changes/datasource-schema-restart-fix/files-modified.md`
  — this file, rewritten to cover cycles 1 + 1b + 2.
- `openspec/changes/datasource-schema-restart-fix/executor-report-2.md`
  (new) — cycle-2 delivery report (see file).

## File-size budgets

All edited / new files stay under the 400-line hard cap.
`DataSourceService.scala` grew from 337 → 354 lines; the cycle-1b
soft-warning was already present and the cycle-2 work added 17 lines
net (Fix D + a few comment lines). No new soft-cap introductions.
