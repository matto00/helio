# Ticket — backend-pipeline-step-adt (CS2c-3a)

**Linear:** HEL-236 (sub-PR 7 of 7 — first half of CS2c-3)

**Branch:** `task/backend-pipeline-step-adt/HEL-236`

**Worktree:** `.worktrees/HEL-236-cs2c-3a/`

**Parent change folder for series design:** `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` — the CS2c-series architectural design lives there. Inherit its discriminator/wire-shape pattern, repo dispatch pattern, frontend-lockstep rule, and file-size targets.

**Sibling that established the pattern:** `openspec/changes/2026-05-14-backend-datasource-adt/` (CS2c-2, merged as PR #150). The wire-shape evolution executed there (`sourceType` → `type` discriminator + typed `config` payload, `RootJsonFormat` dispatch, credential redaction in responses, frontend discriminated union + narrowing helpers) is the template for this PR.

## Scope

Replace `PipelineStep` (today: wide flat case class with stringly-typed `op` and stringly-typed `config: String`) with a **sealed-trait ADT of 10 step subtypes**, each with its own typed config case class. Split `InProcessPipelineEngine` into a `PipelineStepHandler` per kind. Extract `PipelineRunService` from `PipelineRunRoutes` (route is 380L today — well above the 150L target). Decompose `PipelineRunRoutes` into per-endpoint route files.

In scope:
1. **PipelineStep ADT** in `domain/Pipeline.scala` (new file, or co-locate in existing `domain/`):
   - `sealed trait PipelineStep` + `PipelineStepKind` discriminator helper
   - 10 subtypes: `RenameStep`, `FilterStep`, `JoinStep`, `ComputeStep`, `GroupByStep`, `CastStep`, `SelectStep`, `LimitStep`, `SortStep`, `AggregateStep`
   - Per-subtype config case classes (`FilterConfig`, `JoinConfig`, etc.) — typed, no `JsObject` blobs at domain boundaries
   - Latent gap: `PipelineService.AllowedOps` is missing `"aggregate"` today (`InProcessPipelineEngine.applyStep` accepts it; service-layer validation rejects it). Fix in this PR by deriving allow-list from the ADT.
2. **Engine split**:
   - `InProcessPipelineEngine.applyStep` 11-case match → typed dispatch on the ADT (or pluggable handler registry)
   - Per-step handler extraction (10 handlers) so the file falls under 250L target. Today the file is 457L.
   - `loadRows` already dispatches on `DataSource` ADT (CS2c-2). Preserve current behavior.
3. **PipelineRunService extraction**:
   - New `services/PipelineRunService` taking over the run-lifecycle logic currently inline in `PipelineRunRoutes`
   - Pre-execution (insert run record + prune old runs), execution dispatch (in-process vs spark), result publication, dry-run handling
   - Wire-shape unchanged for run endpoints — this is a pure server-side restructure
4. **PipelineRunRoutes decomp**:
   - Split into focused route files under 150L each (suggested: `PipelineRunSubmitRoutes`, `PipelineRunStatusRoutes`, `PipelineRunHistoryRoutes`, `PipelineRunStreamRoutes` — executor decides final split based on natural seams)
   - Routes become thin HTTP shells dispatching to `PipelineRunService`
5. **Wire-shape evolution for PipelineStep CRUD** (`/api/pipelines/:id/steps`, `/api/pipeline-steps/:id`):
   - `op: String` + `config: String` (stringified JSON) → `type: String` discriminator + typed `config: JsObject` (parsed object, no string-of-JSON)
   - `RootJsonFormat[PipelineStep]` dispatching on `type` with per-subtype `config` shape
   - Analyze response (`AnalyzeStepResponse`) follows the same shape
   - DB columns (`step.op`, `step.config`) stay unchanged — discriminate on existing `op` column; `config` continues to store JSON text but the **wire** moves to typed objects
6. **Frontend lockstep**:
   - `PipelineStep` becomes a discriminated union over `type` with typed `config` per subtype
   - `AnalyzeStepResult` likewise
   - `pipelinesSlice`, `pipelineService`, `PipelineDetailPage`, `CreatePipelineModal`, step editor components updated
   - Narrowing helpers (`isFilterStep`, etc.) only if 3+ consumers need the same narrow (CS2c-2 rule)
7. **Spark submitter alignment**:
   - `SparkJobSubmitter.scala:152` pattern-match on `step.op` — convert to ADT dispatch
   - Spark job descriptor JSON shape coordinated with Spark side if applicable; for the in-process path this is a domain-internal change
8. **Tests**:
   - Per-subtype protocol round-trip tests
   - Engine handler tests for every kind (parity with current behavior — these are existing tests, mostly preserved with constructor changes)
   - PipelineRunService unit tests (extracted from PipelineRunRoutesSpec)
   - Cross-type PATCH locked: changing `type` on existing step returns 400 (matches CS2c-2 DataSource policy)
9. **OpenSpec spec.md sync** for any spec files referencing pipeline step request/response shapes
10. **Smoke validation** — Playwright Phase 3 by evaluator: create pipeline → add 3 steps (filter, sort, limit) → analyze → dry-run → real run → review results

Out of scope (deferred to CS2c-3b):
- Panel ADT and all panel-related changes
- Snapshot import/export updates (Panel ADT depends — defer to CS2c-3b)
- HEL-242 (Panel ↔ DataType binding fix — lands in or after CS2c-3b)

Out of scope (deferred to CS3 / later):
- Frontend feature-folder restructure
- Per-step-kind frontend editor decomposition beyond minimum needed to consume the new wire shape

## Why now

CS2c-2 proved the discriminator/typed-config pattern end-to-end. PipelineStep is the natural next ADT — it has 10 subtypes (most ADT-shaped surface of any domain object in Helio), an 11-case `match` in the engine that exemplifies the switch-case bug surface, a route file 2.5× over budget, and a service-layer allow-list out of sync with the engine. Landing this before Panel ADT (CS2c-3b) keeps blast radius bounded — Pipeline changes don't touch the dashboard render path, so any wire-shape contract issues surface in pipeline UI only, not panel rendering. CS2c-3b will inherit the same patterns plus the Panel-specific bound/unbound intermediate trait structure.

## Acceptance criteria

- [ ] `sbt test` green (existing baseline + new ADT/protocol/service tests; expect no regressions)
- [ ] `npm test`, `npm run lint`, `npm run format:check` green
- [ ] `npm run check:schemas`, `npm run check:openspec`, `npm run check:scala-quality` clean
- [ ] File-size budgets:
  - `InProcessPipelineEngine.scala` ≤ 250 lines (split into handlers under `domain/pipeline/handlers/` or similar)
  - `PipelineRunRoutes.scala` deleted; replacement route files each ≤ 150 lines
  - `PipelineRunService.scala` ≤ 300 lines
  - `PipelineProtocol.scala` ≤ 250 lines (split `PipelineStepProtocol.scala` if needed)
- [ ] `PipelineService.AllowedOps` removed (allow-list derived from ADT sealed-trait subclasses)
- [ ] No stringly-typed `op` or `config: String` arguments crossing service-boundary call sites (repo internals may continue to use String columns)
- [ ] Cross-type PATCH locked (mutating step `type` returns 400 with clear error message)
- [ ] `AuthService` unchanged: `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` clean
- [ ] Playwright smoke: full pipeline lifecycle (create → 3 steps → analyze → dry-run → real run → results) passes
