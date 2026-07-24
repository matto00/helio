## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket acceptance criteria addressed explicitly:
  - Flooring semantics for day/week/month/quarter/year, unparseable → null, unsupported granularity
    → descriptive execute-time error — implemented in `DateBucketStep.scala`, verified by 9 passing
    unit tests in `InProcessPipelineEngineSpec.scala` and confirmed live via the UI preview
    (`2026-03-17T14:32:00Z` → `2026-03-17` at day granularity).
  - `analyze_pipeline` apply/infer parity (`outputColumn` typed `date`, replace-in-place vs append)
    — implemented in `PipelineAnalyzeService.inferDateBucket`, verified by 3 passing analyze tests
    and confirmed live (`GET /analyze` returned `outputSchema` with `date_month` typed `date`).
  - `pipeline_steps_op_check` migration (`V64__add_datebucket_op.sql`) — applies cleanly (Flyway log
    confirms `Migrating schema "public" to version "64 - add datebucket op"`); V-number correctly
    re-confirmed against the actual worktree max (V63) rather than trusting the ticket's stale "V59"
    note — exactly per the ticket's merge-hazard instruction.
  - Frontend `StepCard` editor renders and PATCHes round-trip — confirmed live end-to-end (field
    select, granularity select, output-column input all persist via `PATCH /api/pipeline-steps/:id`
    returning 200).
  - MCP `add_pipeline_step` documents `datebucket` — confirmed in `write.ts` diff.
  - Test coverage matches the ticket's enumerated list exactly (execution round-trip incl. each
    granularity + unparseable + unsupported-granularity, analyze-schema, codec round-trip,
    `PipelineStepSpec` kind-parity 13→14, plus the frontend `DateBucketConfig.test.tsx`).
  - Backward compatible / additive only — no existing files' behavior changed beyond registration
    arms; full backend (1792 tests) and full frontend (1265 tests) suites pass with zero
    regressions.
- No AC was silently reinterpreted. The two documented self-approvals in design.md (jsonFormat3 vs.
  the ticket's "jsonFormat6" typo; outputColumn default is literally `field`) are correctly-reasoned
  corrections of an internally-inconsistent ticket detail, not scope changes, and are called out
  explicitly rather than silently.
- No scope creep: the "also updated" file lists in tasks.md/files-modified.md (package.scala,
  PipelineStepRepository.scala, PipelineService.scala, PipelineStepProtocolSpec.scala) are the same
  match-site set every prior op addition (`splittext`/`extractheadings`/`chunkbytokencount`) touches
  — confirmed by grepping for kind-name occurrences in `backend/src/main` and `frontend/src`: the
  `datebucket` file set is an exact 1:1 match to the `chunkbytokencount` precedent, no more, no
  fewer files.
- No regressions to existing behavior: full backend and frontend test suites pass (1792 + 1265
  tests); `check:schemas` (schema↔protocol parity) and `check:scala-quality` (inline-FQN + file-size
  gate) both pass clean.
- Planning artifacts (design.md, tasks.md, files-modified.md, spec.md) accurately reflect the final
  implementation — cross-checked field-by-field against the diff.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md [mechanical] compliance**: no inline fully-qualified names introduced (verified
  by `npm run check:scala-quality` — clean, only pre-existing file-size soft-warnings on unrelated
  test files, none touched by this change crossing a new threshold). `DateBucketStep.scala` (133
  lines) is well under the 250-line soft budget.
- **DESIGN.md [mechanical] compliance**: `DateBucketConfig.tsx` introduces no new CSS — it reuses
  the exact class names (`pipeline-detail-page__splittext-config`,
  `pipeline-detail-page__compute-field`, `pipeline-detail-page__compute-label`) that
  `SplitTextConfig`/`ExtractHeadingsConfig`/`ChunkByTokenCountConfig` already use for this identical
  layout shape — no hardcoded colors, no new control-height values, no translucency. Uses the shared
  `Select`/`TextField` components from `shared/ui`, not raw `<select>`/`<input>`.
- **DRY**: the epoch-seconds/millis heuristic, the ISO-week-Monday adjuster, and the `filterNot` +
  `:+` replace-or-append inference pattern all reuse established idioms (`TemporalAdjusters`,
  `CastStep`'s null-on-failure contract, `inferSplitText`'s collision-safe schema merge) rather than
  reinventing them.
- **Readable**: `floorFn`/`parseToUtcDate` are small, well-named, and the granularity mapping is a
  simple exhaustive `match`. No magic numbers beyond the documented epoch-digit-count heuristic
  (explained inline and in design.md).
- **Modular**: config/step/companion follow the exact per-kind module shape every other step uses;
  no new abstraction was introduced.
- **Type safety**: `DateBucketConfig`/`DateBucketConfigValue` are fully typed on both sides; no `any`
  in the new frontend code (`npm run lint` — zero warnings, zero errors).
- **Error handling**: row-level parse failures → `null` (never throw), config-level
  misconfiguration (`granularity`) → a failed `Future` with a descriptive message; the analyze-layer
  `parseConfig` try/catch already covers a missing `field` key gracefully (verified: `json.fields
  ("field")` throwing is caught, producing `"datebucket config error"` rather than a 500).
- **Tests meaningful**: 9 backend execution tests exercise every granularity, both epoch shapes, the
  outputColumn-append path, unparseable→null, and unsupported-granularity failure — these would
  catch a real regression in the flooring math (e.g. an off-by-one in the quarter calc, or a
  Sunday-vs-Monday week-start swap). 6 frontend component tests cover every control's onChange
  contract. All 180 targeted backend tests and full 1792/1265 suites pass.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the new files.
- **No over-engineering**: no premature abstraction — the op follows the established template
  exactly, as design.md commits to upfront.
- **Behavior-preserving**: this is purely additive (new step kind); no existing step's behavior was
  touched. Grep-diffed the touched shared files (`PipelineStep.scala`, `PipelineAnalyzeService.scala`,
  etc.) — every edit is an additive registration arm, no existing arm was altered.

Minor (non-blocking) observation: the executor's `files-modified.md` "Root cause / probe notes"
section correctly notes no debugging was required (purely additive feature work), consistent with
the systematic-debugging Iron Law's scope (applies to fixes, not new-feature builds).

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` and verified healthy via
`assert-phase.sh servers` (PASS) before testing.

- **Happy path end-to-end**: created a fresh static data source (`eval-datebucket-src`, column `ts`
  seeded with `2026-03-17T14:32:00Z`) and a fresh pipeline, added a `datebucket` step via the "+ Add
  transformation step" menu (the "Date bucket" entry with a calendar-week icon is present alongside
  the other 11 ops), selected `ts` as the source field, left granularity at the `day` default, and
  used "Preview data" — the live preview correctly returned `ts → "2026-03-17"`, confirming the
  flooring math end-to-end through the real HTTP stack, not just unit tests.
- Also exercised the granularity dropdown (exactly 5 options: day/week/month/quarter/year, matching
  the spec) and the output-column text input against the pre-existing "Profit (migrated)" pipeline —
  selecting `date` as field, `month` granularity, and `date_month` as outputColumn correctly PATCHed
  (200 OK on every change) and the `analyze` response schema updated to include `date_month` typed
  `date` (append case) while leaving `date`/`profit` unchanged — apply/infer parity confirmed live.
  That pipeline's real source data happens to be stored as US-format `M/D/YYYY` strings (not ISO), so
  the preview correctly returned `null` for `date_month` there — this is the spec'd
  unparseable-value-yields-null behavior working as intended, not a bug (confirmed separately against
  ISO input above, which produced a non-null result).
- **Unhappy paths**: unparseable input is handled gracefully (`null` in the row, no exception, no
  blank preview) — confirmed against real (accidentally non-ISO) production-like data.
- **No console errors** attributable to the new code across the whole flow (source creation, pipeline
  creation, step add/configure/preview). The one console error observed
  (`GET .../schedule → 404`) is pre-existing, unrelated app behavior (every pipeline without a
  schedule triggers this on load; the UI renders "No schedule set" gracefully, not a blank screen).
- **Entry points**: verified via both the pre-existing "Profit (migrated)" pipeline and a freshly
  created pipeline — the editor renders identically from both.
- **Accessible names / keyboard**: all three controls have distinct accessible names ("Source field
  to bucket", "Bucket granularity", "Output column") queryable by role, matching the
  `DateBucketConfig.test.tsx` assertions; the shared `Select` component's combobox/option role pattern
  and `TextField`'s labeled input are both used, consistent with the rest of the StepCard editors.
- **Breakpoints**: rendered without layout breakage at 1440 / 1100 / 768 (screenshots captured and
  reviewed — hairline borders, spacing, and control heights all consistent with the surrounding
  `cast`/`compute`/`splittext` editors at every width; the app's bottom mobile nav bar appears
  correctly at 768).

### Overall: PASS

### Non-blocking Suggestions
- None.
