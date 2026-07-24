## Evaluation Report — Cycle 1

**Note on diff base**: the worktree's local `main` ref was stale (behind by two
already-merged commits, HEL-380/HEL-376). Diffed against `origin/main`
(4f4eb147) instead of the stale local `main` (1bb95832) to isolate the actual
HEL-382 change (32 files, +1055/-11).

### Phase 1: Spec Review — PASS
Issues: none.

- All 7 ticket acceptance criteria addressed explicitly:
  - dedupe removes duplicates by key set / whole row, keep first/last, stable order — implemented in `DedupeStep.scala` and verified with fresh test run + live browser round-trip.
  - `analyze_pipeline` identity passthrough — `'dedupe'` added to the `filter`/`limit`/`sort` group in `PipelineAnalyzeService.scala`; confirmed live (`outputSchema` == `inputSchema`, `validationError: null`).
  - Flyway migration `V68__add_dedupe_op.sql` applies cleanly (verified: full `sbt test` migrates schema to v68 with no errors).
  - Frontend StepCard renders working editor; config PATCHes round-trip (verified live: PATCH 200, GET reflects `{"keep":"first","keys":["name"]}`).
  - MCP `add_pipeline_step` description documents `dedupe` + `{keys, keep}` shape.
  - Tests present and passing for all listed scenarios (round-trip execution, analyze passthrough, codec round-trip, kind-parity).
  - Backward compatible — additive only, no existing files' behavior changed beyond registering the new kind.
- No AC silently reinterpreted.
- Tasks.md: all items checked, and each checked item's claim matches the actual diff (spot-checked migration re-confirmation claim — V68 is genuinely still the max file in the directory).
- No scope creep — diff is limited to the ticket's declared impact surface (backend op-surface wiring, one migration, frontend editor wiring, MCP tool description, planning artifacts). No unrelated refactors.
- No regressions to existing behavior: full backend suite (1855 tests) and full frontend suite (1313 tests) pass with zero failures.
- API contract: schemas are implicit in the wire protocol files, not `schemas/JSON Schema`; `PipelineStepProtocol`/`PipelineAnalyzeProtocol` both updated with the new discriminated-union arm — consistent with how other ops (pivot/window/unpivot) are wired, no separate `schemas/` directory touch needed for this op family.
- Planning artifacts (design.md decisions: sorted-by-field-name whole-row key, single-pass first / lookahead-pass last, tolerant decode) match the implemented `DedupeStep.scala` exactly.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Canonical code-quality compliance**: `npm run check:scala-quality` passes clean (0 hard violations — no inline FQNs introduced). `DedupeStep.scala` is 117 lines, well under the 250-line soft budget; no new soft-budget violations from this diff (all reported soft warnings are pre-existing files untouched by this change).
- **Exhaustive-match consumers**: all consumers listed in the ticket's "Consumers to update" section, plus tasks.md's more complete list, are updated: `PipelineStep.Registry`/`PipelineStepKind` (registry-derived, no manual `All` update needed per the existing "cycle 3" registry-derivation comment), `domain/package.scala`, `PipelineStepProtocol.scala` (write/read union arms + `fromDomain`), `PipelineStepConfigCodec.scala` (`encodeConfig`/`extractConfig`), `PipelineAnalyzeProtocol.scala`, `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`. Grepped for any remaining non-exhaustive `match` on step kinds; none found.
- **DRY**: `DedupeConfig.tsx` explicitly reuses `SelectFieldsConfig`'s checkbox-list CSS classes and the filter-combinator toggle-button recipe rather than inventing new UI — confirmed both class families already exist in `PipelineDetailPage.css` (`__select-fields-list`, `__filter-combinator-btn`, etc.) and are not duplicated.
- **Readable**: `DedupeStep.apply`'s two branches (`keep=first` single-pass seen-set vs `keep=last` lookahead-pass) are clearly commented and match the design doc's stated algorithm; no magic values.
- **Modular**: step logic, protocol wiring, and UI are cleanly separated, matching the existing per-op file layout.
- **Type safety**: `DedupeConfigValue`/`DedupeConfig` are fully typed on both sides; no untyped escape hatches.
- **Error handling**: `DedupeConfig.decode` is tolerant (never throws) per the established pattern; unknown-kind lookups fail with descriptive `Left`/`IllegalStateException` messages consistent with sibling ops.
- **Tests meaningful**: engine tests cover all 5 spec scenarios (whole-row distinct, key-set first, key-set last, null-key collapse, missing-keep-default) plus an explicit stable-order-preservation test not in the spec but a good regression guard. Frontend test covers key selection/deselection, empty-columns rendering, and toggle `onChange` + `aria-pressed`.
- **No dead code**: no leftover TODO/FIXME; no unused imports (confirmed via `npm run lint` zero-warnings pass and scala-quality clean run).
- **No over-engineering**: implementation matches `LimitStep`'s simplicity bar as directed; no premature abstraction.
- **Behavior-preserving**: this is a pure additive change; no existing op's behavior was touched.

Non-blocking suggestion (see below) on import ordering.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via canonical script; `assert-phase.sh servers` returned `PASS`.

Manual verification on the "HEL-315 offers pipe" pipeline (live data, 3 rows: Alpha/10, Beta/20, Gamma/30):

- **Happy path**: Added a `dedupe` step via the op-type dropdown ("Dedupe rows" entry present with a clone icon). `StepCard` expanded to show the `DedupeConfig` editor: key-fields checklist populated from the real `analyzeColumns` (`name`, `amount`), and a FIRST/LAST toggle.
- Toggled a key checkbox (`name`) → `onChange` fired → `useStepCardState`'s `onDedupeChange` persisted via `PATCH /api/pipeline-steps/:id` (200 OK) → re-fetched `GET /api/pipelines/:id/steps` confirmed `{"keep":"first","keys":["name"]}` was durably stored.
- Toggled keep FIRST → LAST → button `aria-pressed` state flipped correctly and re-rendered.
- Clicked "Preview data" on the step → correct data-grid rendered with `name`/`amount` columns and all 3 (non-duplicate) rows, confirming the execution path works end-to-end.
- Clicked "Dry run" → `POST /api/pipelines/:id/run?dry=true` returned 200; `GET /api/pipelines/:id/analyze` confirmed `outputSchema` == `inputSchema` == `[{name:string},{amount:number}]` for the dedupe step, with `validationError: null` — matches the identity-passthrough AC exactly.
- **Unhappy/empty states**: N/A specific to dedupe (pure additive op, no new error states introduced); existing empty-columns state renders an empty `<ul>` per `DedupeConfig.test.tsx` coverage, confirmed by code read.
- **Console errors**: zero new console errors introduced by any dedupe interaction. Two console entries observed throughout the session, both pre-existing and unrelated to this change: a 404 on `GET .../schedule` (expected — pipeline has no schedule set, endpoint untouched by this diff) and a transient 502 on `GET .../run-events` (SSE stream endpoint, untouched by this diff, not reproducible on repeat).
- **Entry points**: dedupe is reachable from the standard "+ Add step"/"+ Add transformation step" op-picker, the only entry point for any pipeline op — consistent with sibling ops.
- **Accessible names / keyboard**: checkboxes have accessible names (`"name"`, `"amount"`), toggle buttons expose `aria-pressed`, both are standard interactive elements reachable via keyboard (native `<input type="checkbox">` / `<button>`).
- **Breakpoints**: resized to 768px — `DedupeConfig` renders cleanly (checkboxes wrap, toggle buttons stay inline, no overflow/clipping) per screenshot. Did not detect layout breakage at any tested width; the component uses only pre-existing shared classes, no new responsive rules were introduced that could regress other widths.

Cleaned up: removed the test step from the live pipeline after verification, restoring it to its original 0-step state.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` import block: `DedupeConfig`/`DedupeStep` were inserted before `DateBucketStep` (line ~13), breaking the otherwise-alphabetical ordering of the `com.helio.domain` import list (`DateBucketConfig, DedupeConfig, DedupeStep, DateBucketStep, ExtractHeadingsConfig, ...`). Not a mechanical lint violation (no scalafmt import-sorting config is enforced in this repo) and does not affect compilation, but worth a quick alphabetical fix for consistency with the rest of the file on a future pass.
