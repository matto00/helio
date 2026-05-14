# Tasks — backend-domain-adts (CS2c)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, `proposal.md`, `design.md`
- [x] 0.3 Read memory: `feedback-no-inline-fqns.md`, `feedback-refactor-discipline.md`, `project-backend-architecture-remodel.md`

## 1. Foundations (do these first — they don't change wire shape)

- [x] 1.1 Add `PipelineRunId` value class in `domain/model.scala`
- [x] 1.2 Add `PipelineStepIdSegment` and `PipelineRunIdSegment` to `api/protocols/IdParsing.scala`
- [x] 1.3 Narrow `PipelineRepository` / `PipelineStepRepository` / `PipelineRunRepository` signatures to value-class IDs (`PipelineId`, `PipelineStepId`, `PipelineRunId`)
- [x] 1.4 `sbt compile` then `sbt test` — full green (511 tests, was 511 before)
- [ ] 1.5 Commit: "HEL-236 CS2c foundations: PipelineRunId value class + segments + repo ID narrowing"

## 2. DataSource ADT (smallest blast radius — start here)

### 2.1 Backend domain + infrastructure

- [ ] 2.1.1 Create `domain/DataSource.scala` — `sealed trait DataSource` + 4 subtypes (`CsvSource`, `RestSource`, `SqlSource`, `StaticSource`); co-locate `CsvSourceConfig` if not already typed (use existing `RestApiConfig`, `SqlSourceConfig`)
- [ ] 2.1.2 Remove old `DataSource` flat case class from `domain/model.scala`
- [ ] 2.1.3 Update `infrastructure/DataSourceRepository.rowToDomain` to dispatch on `source_type` column and return the typed subtype; update `domainToRow` to flatten back. Keep `data_sources` table shape unchanged.
- [ ] 2.1.4 Update `api/protocols/DataSourceProtocol.scala` — discriminated-union JsonFormat with `type` discriminator
- [ ] 2.1.5 Update `services/DataSourceService.scala` and `services/SourceService.scala` to consume the typed ADT (no more `config.convertTo[X]` at the service layer — typed in the constructor)
- [ ] 2.1.6 Update `routes/DataSourceRoutes.scala`, `routes/DataSourcePreviewRoutes.scala`, `routes/SourceRoutes.scala`, `routes/SourcePreviewRoutes.scala` to consume the new shape (mostly mechanical — same endpoints, new typed payloads)
- [ ] 2.1.7 `sbt test` — green

### 2.2 Frontend DataSource type sync

- [ ] 2.2.1 Update `frontend/src/types/models.ts` — `DataSource` becomes a discriminated union over `type`
- [ ] 2.2.2 Update `frontend/src/slices/dataSourcesSlice.ts` to match the new shape
- [ ] 2.2.3 Update source editor components — type narrowing via `if (source.type === 'csv')` etc.
- [ ] 2.2.4 `npm run lint`, `npm test`, `npm run format:check` — green
- [ ] 2.2.5 Commit: "HEL-236 CS2c: DataSource ADT + wire shape evolution"

## 3. PipelineStep ADT (medium blast radius)

### 3.1 Backend domain + steps + engine

- [ ] 3.1.1 Create `domain/pipeline/PipelineStep.scala` — `sealed trait PipelineStep` with shared fields + `def apply(rows)`
- [ ] 3.1.2 Create `domain/pipeline/steps/RenameStep.scala`, `FilterStep.scala`, `ComputeStep.scala`, `GroupByStep.scala`, `AggregateStep.scala`, `CastStep.scala`, `JoinStep.scala`, `SelectStep.scala`, `LimitStep.scala`, `SortStep.scala` — each ≤ 80 lines, holds typed config + `apply` method (logic migrated from `InProcessPipelineEngine.applyX`)
- [ ] 3.1.3 Remove old `PipelineStep` flat case class from `domain/model.scala`
- [ ] 3.1.4 Slim `domain/InProcessPipelineEngine.scala` to ≤ 250 lines — dispatcher only, calls `step.apply(rows)` polymorphically
- [ ] 3.1.5 Update `infrastructure/PipelineStepRepository.rowToDomain` to dispatch on `op` column and decode typed config
- [ ] 3.1.6 Update `api/protocols/PipelineStepProtocol.scala` — discriminated-union formatter (10 cases)
- [ ] 3.1.7 Update `services/PipelineService.scala` to consume typed steps
- [ ] 3.1.8 Update `routes/PipelineStepRoutes.scala` (request body becomes discriminated union)
- [ ] 3.1.9 Codify inner-vs-left-join default in `JoinStep.scala` header comment per design.md "Inner-vs-left-join policy"
- [ ] 3.1.10 `sbt test` — green

### 3.2 PipelineRunService extraction

- [ ] 3.2.1 Create `services/PipelineRunService.scala` — `startRun`, `getRun`, `listRuns`, `cancelRun` etc. (matches CS2b service shape, ≤ 250 lines)
- [ ] 3.2.2 Move run lifecycle logic out of `routes/PipelineRunRoutes.scala`
- [ ] 3.2.3 Slim `routes/PipelineRunRoutes.scala` to ≤ 150 lines (thin route + ServiceResponse adapter)
- [ ] 3.2.4 Wire `PipelineRunService` into `ApiRoutes.scala`
- [ ] 3.2.5 `sbt test` — green

### 3.3 Frontend PipelineStep type sync

- [ ] 3.3.1 Update `frontend/src/types/models.ts` — `PipelineStep` discriminated union (10 subtypes)
- [ ] 3.3.2 Update `frontend/src/slices/pipelinesSlice.ts`
- [ ] 3.3.3 Update step editor components — narrow per subtype
- [ ] 3.3.4 `npm run lint`, `npm test`, `npm run format:check` — green
- [ ] 3.3.5 Commit: "HEL-236 CS2c: PipelineStep ADT + engine split + run-lifecycle decomp"

## 4. Panel ADT (largest blast radius — do last)

### 4.1 Backend domain + infrastructure

- [ ] 4.1.1 Create `domain/Panel.scala` — `sealed trait Panel`, `BoundPanel` and `UnboundPanel` intermediate traits, 7 subtypes
- [ ] 4.1.2 Remove old `Panel` flat case class from `domain/model.scala`; `PanelType` sealed trait stays (or gets renamed `PanelKind` if it collides — executor's call)
- [ ] 4.1.3 Update `infrastructure/PanelRepository.rowToDomain` + `domainToRow` to dispatch on `type` column; default nullable subtype-specific columns where current schema permits NULL (see design.md "DB row → typed ADT mapping")
- [ ] 4.1.4 Update `api/protocols/PanelProtocol.scala` — discriminated-union formatter (7 cases). Patch shape becomes typed per subtype (see design.md "PATCH semantics")
- [ ] 4.1.5 Update `services/PanelService.scala` and `services/PanelPatchApplier.scala`:
  - `resolveBindingsForRead` fans out only over `BoundPanel`
  - PATCH dispatch is typed; cross-type PATCH returns 400 (matches design.md)
  - Preserve `Option[Option[_]]` semantics on nullable bound-panel fields
- [ ] 4.1.6 Update `routes/PanelRoutes.scala` — new typed request bodies for create / PATCH
- [ ] 4.1.7 Update `routes/DashboardRoutes.scala` + `routes/DashboardSnapshotRoutes.scala` (export/import payloads carry the new panel shape)
- [ ] 4.1.8 Update `routes/PublicDashboardRoutes.scala`
- [ ] 4.1.9 `sbt test` — green

### 4.2 Frontend Panel type sync

- [ ] 4.2.1 Update `frontend/src/types/models.ts` — `Panel` discriminated union (7 subtypes), `PanelBase` shared
- [ ] 4.2.2 Update `frontend/src/slices/panelsSlice.ts` and `frontend/src/slices/dashboardsSlice.ts` thunk payloads
- [ ] 4.2.3 Update panel renderers — narrow per subtype
- [ ] 4.2.4 Update panel detail modal — typed config form per subtype
- [ ] 4.2.5 Update panel creation modal — typed config form per subtype, no cross-type conversion option
- [ ] 4.2.6 Update snapshot export/import code path (the JSON shape evolves there too)
- [ ] 4.2.7 `npm run lint`, `npm test`, `npm run format:check` — green
- [ ] 4.2.8 Commit: "HEL-236 CS2c: Panel ADT + wire shape evolution + frontend type sync"

## 5. Cross-cutting alignment

- [ ] 5.1 Update `schemas/` JSON Schema files for Panel, DataSource, PipelineStep — discriminated-union schemas with `oneOf` / `discriminator`
- [ ] 5.2 Update `openspec/specs/api/v1.yaml` (if present) with the evolved response/request shapes
- [ ] 5.3 Run `npm run check:schemas` — must pass
- [ ] 5.4 Inner-vs-left-join policy: brief note added to `CONTRIBUTING.md` "Backend" section (one paragraph)

## 6. Verification gates

- [ ] 6.1 `sbt test` — full green (count baseline + any new tests; document delta)
- [ ] 6.2 `npm test` — full green
- [ ] 6.3 `npm run check:schemas` — passes
- [ ] 6.4 `npm run check:openspec` — passes
- [ ] 6.5 `npm run lint` — zero warnings
- [ ] 6.6 `npm run format:check` — passes
- [ ] 6.7 `npm run check:scala-quality` — passes (no inline FQNs)
- [ ] 6.8 File-size budget audit:
  - [ ] every route file ≤ 150 lines
  - [ ] every service file ≤ 300 lines
  - [ ] every other src file ≤ 250 lines
  - [ ] `JsonProtocols.scala` aggregator ≤ 80 lines
- [ ] 6.9 No `match { case PanelType.X => ... }` / `match { case SourceType.X => ... }` / `match { case "filter" => ... }` switch-cases outside of:
  - JSON formatters (one each — discriminator dispatch)
  - Repository `rowToDomain` (one each — DB column to ADT mapping)
  - Test fixtures (acceptable)
- [ ] 6.10 `services/AuthService.scala` unchanged (or only mechanical compile fixes — diff must show no security-path changes)

## 7. Smoke validation (executor runs)

- [ ] 7.1 Backend starts cleanly with `BACKEND_PORT=8081 sbt run`
- [ ] 7.2 Frontend starts cleanly with `DEV_PORT=5174 npm run dev`
- [ ] 7.3 Manual Playwright smoke (the 8-step flow from design.md) — every step passes

## 8. Commit / PR handoff

- [ ] 8.1 Multi-commit history matches the per-area sequencing (foundations → DataSource → PipelineStep + engine split + run-lifecycle → Panel)
- [ ] 8.2 All commits on branch `task/backend-domain-adts/HEL-236`
- [ ] 8.3 Orchestrator handles push + PR — do not push

## Spinoff candidates (capture, do NOT pull into CS2c)

Items the executor identifies as worth doing but out-of-scope. Report back:

- [ ] 9.1 Step ADT-based static analysis (compile-time validation of pipeline shape: e.g., LimitStep before SortStep is suspicious)
- [ ] 9.2 Per-subtype DB tables (vs current shared-table-with-discriminator) — only if a real win emerges
- [ ] 9.3 Cross-type panel conversion in UI (locked out in CS2c — re-evaluate if users ask)
- [ ] 9.4 Anything else surfaced during work
