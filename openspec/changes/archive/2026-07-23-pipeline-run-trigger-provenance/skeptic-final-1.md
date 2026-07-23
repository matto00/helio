## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth setup**
- The worktree's local `main` ref was stale (pre-dated HEL-414/415/416); confirmed via
  `git fetch origin main` that `origin/main` already contains those three merged commits, matching
  the ticket's batch-context claim. Isolated the actual HEL-417 diff to the single commit
  `git show 5f4d7703 --stat` (28 files, 949/66) rather than trusting the polluted
  `main...HEAD` three-dot diff, which included the already-merged predecessor tickets.

**Migration (V63)**
- `ls backend/src/main/resources/db/migration/ | sort -V | tail` confirms `V63` is the correct
  next-available VNN after `V62__pipeline_schedules.sql` (no collision).
- Read `V63__pipeline_run_trigger_source.sql`: `ADD COLUMN trigger_source TEXT NOT NULL DEFAULT
  'manual'` + `CHECK (trigger_source IN ('manual','scheduled','external'))` — correct, matches
  design.md Decision 3.
- Ran `sbt "testOnly ...TriggerSourceMigrationSpec ..."` myself (fresh, this session): all 66
  targeted tests pass, including the two-stage staged-migration test (migrate to V62, seed a row
  in the pre-V63 shape with no `trigger_source` column, migrate through V63, assert backfill to
  `manual`) and both CHECK-constraint accept/reject cases. This is a genuine probe, not a
  shallow assertion.
- Ran full `sbt test`: **1700/1700 pass**, 63 migrations apply cleanly at fresh startup — matches
  the executor's claimed numbers exactly.

**All four PipelineRunRepository insert paths**
- Read the full diff of `PipelineRunRepository.scala`: `insertRun`/`insertRunInternal` thread an
  explicit `triggerSource: String = "manual"` parameter through to the `PipelineRunRow`;
  `insertDryRun`/`insertDryRunInternal` hardcode `"manual"` (documented, deliberate — dry runs are
  always interactive, matches design.md's stated risk mitigation).
- `PipelineRunRepositorySpec` diff adds one dedicated test per path (`insertRun` →
  `"scheduled"`, `insertRunInternal` → `"external"`, `insertDryRun`/`insertDryRunInternal` →
  `"manual"`) plus updated the pre-existing default-value assertion. All pass under my own run.

**Scheduler callsite**
- `PipelineSchedulerService.fire` diff: `pipelineRunService.submit(schedule.pipelineId, isDry =
  false, owner, triggerSource = TriggerSource.Scheduled)` — explicit, not inferred. Confirmed via
  `sbt testOnly ...PipelineSchedulerServiceSpec` (my own run, part of the 66-test targeted run
  above) and via a **live, real scheduler firing**: opened the "Profit (migrated)" pipeline in the
  browser, its Run History already contained two real runs with a "Scheduled" badge timestamped
  `12:09:59 AM` / `12:10:59 AM` (60s apart, matching the configured 1-minute interval schedule
  visible in the UI) and one "Manual" run from `7/4/2026` — this is live end-to-end data
  persisted through the real scheduler tick, not a fixture (screenshots below).

**Spray-json `jsonFormat7` → `jsonFormat8` wire-safety claim**
- Independently verified against spray-json 1.3.6 source (`ProductFormatsInstances.scala`,
  `jsonFormat8`): `write` calls `productElement2Field` per declared field name/index and emits a
  `JsObject` keyed by field name (position only determines which case-class field is read via
  reflection, not JSON key order) — so appending a field at the end of a case class is safe for
  the **write** direction, which is the only direction `PipelineRunRecord` is ever used
  (`grep -rn "PipelineRunRecord" backend/src/main/scala/` confirms it's a response type,
  constructed then marshalled to JSON in Scala — never deserialized on the backend). The
  executor's claim holds.

**Schema (`schemas/pipeline-run-record.schema.json`)**
- Read the schema: field set (`id`, `pipelineId`, `status`, `startedAt`, `completedAt`,
  `rowCount`, `errorLog`, `triggerSource`) matches `PipelineRunRecord` exactly. `triggerSource`
  enum is `manual`/`scheduled`/`external`.
- Ran `node scripts/check-schema-drift.mjs` myself: `schemas in sync with JsonProtocols (18
  checked across 21 protocol files)` — passes, and this new schema is one of the 18 checked
  (confirmed by running before/after not applicable — count matches the executor's cycle).
- Noted (non-blocking, pre-existing pattern): the schema marks `completedAt`/`rowCount`/`errorLog`
  as `"required"` with `type: ["string","null"]`, but spray-json's default (no `NullOptions` mixin
  anywhere in this backend, confirmed via `grep -rn "NullOptions" backend/src/main/scala/` →
  no results) **omits** `Option = None` fields from the wire entirely rather than serializing
  `null`. This is technically inaccurate for a `running`/`queued` run (no `completedAt` yet), but
  it is an **existing, pervasive codebase convention** — `alert-event.schema.json` has the exact
  same pattern for `resolvedAt`/`acknowledgedAt`/`snoozedUntil` against a protocol that also
  doesn't mix in `NullOptions`. `check-schema-drift.mjs` only checks field-name parity, not
  required/nullability semantics, so this gap is invisible to the drift check for every schema in
  the repo, not just this one. Not a regression introduced by this ticket — flagged as a
  non-blocking note only.

**Frontend**
- Read the full diff of `pipelineStep.ts`, `pipelineService.ts`, `RunHistoryModal.tsx/.css`: type
  addition, `normalizeRunRecord` defaulting a missing `triggerSource` to `"manual"` applied in
  `fetchRunHistory`, `TriggerSourceBadge` rendered next to `StatusBadge`.
- CSS tokens verified against `frontend/src/theme/theme.css`: `--app-accent`, `--app-warning`,
  `--app-accent-surface`, `--app-warning-surface`, `--app-border-subtle`, `--app-text-muted`,
  `--text-micro`, `--weight-semibold` all defined in both light and dark theme blocks. No hardcoded
  hex/px values. New `.run-history-modal__trigger*` classes are a structural match to the
  pre-existing `.run-history-modal__status*` pattern in the same file (same property list) — DRY
  concern is cosmetic and pre-existing per-variant-class precedent, not new.
- `PipelineRunRepositorySpec`/`PipelineDetailPage.test.tsx` diff confirms real assertions (not
  fixture-only no-ops) for both the "Manual" and "Scheduled" badge text rendering.

**Gates — re-run fresh, myself, this session**
- `sbt test` (backend, full suite): **1700/1700 pass**.
- `npm run lint` (frontend): 0 warnings.
- `npm test` (frontend): **118/118 suites, 1239/1239 tests pass**.
- `npm run build` (frontend): succeeds.
- `npm run format:check`: clean.
- `npm run check:scala-quality`: clean (57 soft file-size warnings only, pre-existing pattern
  across dozens of files — `PipelineRunRepositorySpec.scala` at 329 lines is one of them,
  non-blocking).
- `npm run check:schemas`: passes, 18 schemas in sync.
- `npm run check:openspec`: **fails with exactly one issue** — "change ... is complete (15/15) but
  not archived" — confirming the executor's `-n` bypass note is accurate and not masking a real
  lint/test/format failure. All other hooks pass cleanly per my own runs above.

**Live UI verification (Playwright, DEV_PORT=5590 / BACKEND_PORT=8497)**
- `scripts/concertino/assert-phase.sh servers` → `PASS servers`.
- Navigated to `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485` ("Profit (migrated)") — opened
  Run History modal. Screenshot (light theme): three real runs, two with an orange "Scheduled"
  pill (`--app-accent`), one with a muted-gray "Manual" pill — visually distinct, legible,
  matches the `StatusBadge` pill convention exactly (padding, radius, border, capitalize).
- Toggled dark theme, reopened Run History: same three runs render with correct dark-theme token
  values (orange accent preserved, borders/backgrounds adapt) — good light/dark parity, no
  contrast issues.
- `browser_console_messages(level: error)`: 0 errors across the full flow.

### Verdict: CONFIRM

All five acceptance criteria trace to real, independently-verified code and passing tests:
1. All four insert paths persist `trigger_source` correctly (repository diff + tests, verified).
2. Run History API + UI show provenance (schema, `PipelineRunRoutesSpec`, and live UI screenshots
   in both themes, verified).
3. V63 applies cleanly and backfills existing rows (staged migration test + full `sbt test` with
   63 migrations applying, verified).
4. `schemas/`+`openspec/` updated, tests cover persisted value/response field/UI (schema-drift
   check + full test suite, verified).
5. Backward compatible (spray-json field-name-keyed write semantics independently verified against
   library source; existing manual callsite unaffected by parameter default, verified).

The `-n` hook bypass is exactly what it claims to be (openspec-archive-pending only); no other
hook was bypassed. No design-standard violations, no scope creep beyond the required
`SparkJobSubmitter` compile-compatibility fix (correctly reasoned and tested). Ships.

### Non-blocking notes
- `schemas/pipeline-run-record.schema.json` marks `completedAt`/`rowCount`/`errorLog` as
  `"required"` even though the backend's default spray-json behavior omits `None` fields from the
  wire entirely (no `NullOptions` mixin anywhere in this codebase). This is inaccurate but matches
  an existing, pervasive pattern (e.g. `alert-event.schema.json`) that the schema-drift tooling
  doesn't catch (it only checks field-name parity). Worth a follow-up ticket to either mix in
  `NullOptions` project-wide or correct all such schemas' `required` lists — out of scope for
  HEL-417 specifically.
- `RunHistoryModal.css`: `.run-history-modal__trigger` duplicates ~6 lines of base pill styling
  already on `.run-history-modal__status` (already flagged by the evaluator as non-blocking;
  agree — matches existing per-variant-class precedent in the same file).
