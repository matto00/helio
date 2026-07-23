## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ACs verified directly (not just via executor self-report):
  1. Each persisted run records its trigger source — verified via
     `PipelineRunRepositorySpec` (all 4 insert paths: `insertRun`, `insertRunInternal`,
     `insertDryRun`, `insertDryRunInternal`) and live-DB Playwright verification (see Phase 3):
     a manual run persisted `trigger_source = 'manual'`, a scheduler-fired run persisted
     `trigger_source = 'scheduled'` (confirmed both via `psql` direct query and via the
     Run History UI).
  2. Run History (API + UI) shows provenance per run — confirmed via
     `PipelineRunRoutesSpec`/`PipelineSchedulerServiceSpec` (API) and live UI (both a real
     "Manual" and a real "Scheduled" badge rendered end-to-end, light + dark theme).
  3. Flyway migration applies cleanly fresh + existing DBs, existing rows default to `manual`
     — confirmed by `sbt test` (63 migrations apply cleanly against a fresh embedded Postgres)
     and by the dedicated `TriggerSourceMigrationSpec` staged-migration test (seeds a pre-V63
     row, migrates through V63, asserts backfill to `manual`; also asserts the CHECK constraint
     accepts `scheduled` and rejects an invalid value).
  4. `schemas/` + `openspec/` updated; tests cover persisted value + response field + UI
     rendering — `schemas/pipeline-run-record.schema.json` added and verified in sync via
     `node scripts/check-schema-drift.mjs` (passes); change-dir delta specs
     (`pipeline-run-provenance` new capability, `pipeline-scheduler-runtime` modified) match
     the implemented behavior exactly; task list 5.1–5.5 test coverage confirmed present and
     passing.
  5. Backward compatible: additive column with default, additive response field — confirmed:
     `jsonFormat7` → `jsonFormat8` (spray-json binds by case-class field name via `apply`, not
     position — verified no other consumer constructs `PipelineRunRecord` positionally outside
     the case class itself); `PipelineRunSubmitRoutes`' existing manual callsite is unaffected
     by the new `submit` parameter because it defaults to `TriggerSource.Manual`.
- Task list (tasks.md, 15 items) all marked done and match the diff exactly — no
  reinterpretation. `insertDryRun`/`insertDryRunInternal` hardcode `"manual"` rather than
  threading a caller-supplied parameter (task 2.2 says "thread `triggerSource` through" all
  four; the dry-run pair deliberately doesn't accept a parameter since dry runs are always
  manual per design.md's explicit Decision/Risk note) — this is a documented, deliberate,
  narrower-than-literal-task-wording implementation that matches the design doc's stated
  intent, not silent scope drift.
- No unnecessary changes outside ticket scope. The one incidental touch —
  `SparkJobSubmitter.scala`'s dormant `insertRunInternal` callsite — was required for
  compilation (the method signature changed) and was handled correctly (defaulted to
  `TriggerSource.Manual` with a comment explaining the dormant-path rationale); this is in-scope
  mechanical fallout, not scope creep.
- No regressions: full backend suite (1700 tests) and full frontend suite (1239 tests) both
  green; `npm run build` succeeds.
- Planning artifacts (proposal/design/tasks/specs) accurately reflect the final implementation;
  no drift found between design.md's decisions and the diff.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md mechanical compliance**: `npm run check:scala-quality` reports "clean" (no
  inline-FQN violations) — new `import com.helio.services.TriggerSource` in
  `SparkJobSubmitter.scala` is a proper top-of-file import, not an inline qualifier. File-size
  soft-budget warnings exist but are pre-existing/informational only (`check:scala-quality`
  exits 0); `PipelineRunRepositorySpec.scala` grew to 329 lines (over the 250 soft budget) but
  this is a soft, non-blocking warning consistent with dozens of other pre-existing files in the
  same report.
- **DESIGN.md mechanical compliance** (frontend touched): all new CSS in `RunHistoryModal.css`
  uses canonical tokens only (`--app-accent`, `--app-warning`, `--app-accent-surface`,
  `--app-warning-surface`, `--app-border-subtle`, `--app-text-muted`, `--text-micro`,
  `--weight-semibold`) — verified each is defined in `frontend/src/theme/theme.css` (no ad hoc
  hex/px values introduced). New `.run-history-modal__trigger*` classes directly mirror the
  existing `.run-history-modal__status*` pattern in the same file.
- **DRY**: `TriggerSourceBadge`/`.run-history-modal__trigger` duplicates ~6 lines of base pill
  styling already present in `.run-history-modal__status` (padding/border-radius/font-size/
  font-weight/text-transform). Minor, non-blocking — matches the file's existing per-variant
  class convention (StatusBadge itself doesn't share a base class either), so this is
  consistency with precedent rather than newly-introduced duplication. Flagged as a
  non-blocking suggestion below.
- **Readable/Modular**: `TriggerSource` constants object, `normalizeRunRecord`,
  `TriggerSourceBadge` are all small, clearly named, single-purpose units. No magic strings —
  all three literals route through the `TriggerSource` object or the `TRIGGER_SOURCE_LABELS`
  map.
- **Type safety**: `triggerSource: "manual" | "scheduled" | "external"` is a proper TS union;
  backend uses `String` per design.md's explicit, self-approved precedent-matching decision
  (mirrors the existing `status` field convention) — not an untyped escape hatch.
- **Security**: no new user-controlled input surface — `triggerSource` is only ever
  server-set (constants or scheduler literal), never client-supplied on the write path.
- **Error handling**: no silent failures introduced; `normalizeRunRecord` explicitly documents
  and tests the defensive-default rationale.
- **Tests meaningful**: all 4 repository insert paths, the migration backfill + CHECK
  constraint (both accept and reject cases), the scheduler success and failure paths, the
  manual-API default-value path, and both FE unit/normalization and FE UI-rendering paths are
  exercised. These would catch a real regression (e.g. a dropped `triggerSource` field, a
  flipped default, or a missing scheduler-callsite update).
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: `TriggerSource` is a plain constants object, not a sealed domain
  type — design.md explicitly considered and rejected a sealed trait as disproportionate; this
  matches the existing `status`-field string convention exactly.
- **Behavior-preserving**: this is additive, not a refactor; no drive-by behavior changes
  detected outside the stated scope.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (both
reported healthy on DEV_PORT=5590 / BACKEND_PORT=8497).

- **Happy path end to end**: opened an existing pipeline ("Profit (migrated)") with a real
  manual run in history — Run History modal correctly rendered a "Manual" badge next to
  "Succeeded". Then live-produced a genuine scheduled run: configured a 1-minute interval
  schedule via the HEL-416 UI, waited for `PipelineSchedulerActor`'s real 30s tick to fire it,
  and confirmed via both a direct `psql` query (`trigger_source = 'scheduled'`) and the Run
  History UI (a real "Scheduled" badge, distinct accent color) that the full pipeline —
  scheduler → `PipelineRunService.submit(triggerSource = Scheduled)` →
  `PipelineRunRepository.insertRun` → `pipeline_runs.trigger_source` → run-history API →
  frontend normalization → `RunHistoryModal` — works end to end with real data, not just
  fixtures. External-triggered provenance was not exercised live (no caller exists yet per
  ticket scope — `external` is reserved-only, consistent with the ticket's explicit
  non-goal), but the `pipeline-run-record.schema.json` enum and `TriggerSourceBadge`'s
  `TRIGGER_SOURCE_LABELS` map both correctly define an `external` variant.
- **Unhappy/empty states**: pipelines with no schedule show "No schedule set" gracefully (a
  benign 404 on `GET .../schedule` is the expected not-yet-configured state, handled without a
  blank screen or unhandled exception — pre-existing HEL-416 behavior, unaffected by this
  change).
- **Loading/empty states**: N/A new states introduced by this ticket; existing Run History
  empty state ("No runs recorded yet.") untouched.
- **No console errors**: confirmed clean (0 errors) across the full flow — page load, pipeline
  detail, schedule creation, run history open/close, theme toggle.
- **Entry point**: Run History is opened via the single existing "Open run history" button on
  the pipeline detail page — the only entry point per the ticket scope, exercised directly.
- **Accessible names/keyboard**: `TriggerSourceBadge` is a `<span>` with visible text content
  (not an icon-only control), consistent with the existing `StatusBadge` pattern; no new
  interactive element was added (informational badge only) so no new keyboard-focus surface to
  verify.
- **Breakpoints**: 1440 / 1100 / 768 all rendered the Run History modal (with both provenance
  badges visible) without layout breakage or overflow. 0/mobile breakpoint not separately
  re-verified this cycle (768 already confirms the modal's responsive behavior; the modal
  component itself is unchanged by this ticket beyond the added badge span).
- **Light/dark parity**: verified visually in both themes — badge colors, borders, and
  contrast render correctly in both.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `RunHistoryModal.css`: `.run-history-modal__trigger` duplicates the base pill styling
  (padding/border-radius/font-size/font-weight/text-transform) already defined on
  `.run-history-modal__status`. Consider a future cleanup extracting a shared
  `.run-history-modal__badge` base class if a third badge type is ever added to this file —
  not worth doing now given the file already has this per-variant-class precedent.
