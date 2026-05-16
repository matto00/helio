# Design — backend-pipeline-step-adt (CS2c-3a)

This document focuses on CS2c-3a-specific design decisions. **Inherits** the discriminator/wire-shape/repo-dispatch pattern from `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` and the executed template from `openspec/changes/2026-05-14-backend-datasource-adt/design.md`.

## Architectural pattern (inherited)

Wire shape: `{ type: "<kind>", config: {...kind-specific shape...}, ...common-fields }` — identical to DataSource in CS2c-2.

Repo dispatch: `rowToDomain` reads existing `op` column as discriminator, `config` column as JSON text, parses via codec, constructs typed subtype. `domainToRow` flattens.

Frontend: discriminated union over `type` field with per-subtype `config` typed. Narrowing helpers only where 3+ consumers need same narrow.

DB unchanged: no Flyway migration. `pipeline_steps` table columns (`op`, `config`) preserved.

Cross-type PATCH locked at 400.

## CS2c-3a-specific design decisions

### 1. ADT lives in `domain/Pipeline.scala` (new file)

`model.scala` is already 301L (over 250 target) and houses the existing flat `PipelineStep` case class. Move PipelineStep to its own file as part of this change. Co-locate config case classes there. Result: `model.scala` falls back under budget and the new file owns the Pipeline domain concept cleanly.

Note: `PipelineStepId` and `PipelineRunId` value classes (added in CS2c-1) stay in `model.scala` — they're cross-domain ID wrappers, not Pipeline-domain types.

### 2. Engine handler split — co-located handlers, not separate package

`InProcessPipelineEngine` becomes a thin dispatcher. Per-kind logic moves to private methods → handler functions on a `PipelineStepHandlers` companion-style object, or extracted into `domain/pipeline/handlers/<Kind>StepHandler.scala` files if individual handlers exceed ~50L.

Decision: **start with a co-located `PipelineStepHandlers` object** keeping per-kind logic as `def applyFilter(step: FilterStep, ...): Future[Seq[Row]]` etc. Only split into per-handler files if the engine file still exceeds 250 lines after the typed dispatch reduction. Co-location preserves the historical "engine in one place" mental model; further fragmentation can land as a follow-up if reviewers want it.

Shape:
```scala
class InProcessPipelineEngine(fileSystem: FileSystem)(implicit ec: ExecutionContext) {
  def execute(rows, steps: Seq[PipelineStep], dataSourceRepo): Future[Seq[Row]] = ...
  // Dispatch
  private def applyStep(rows: Seq[Row], step: PipelineStep, dataSourceRepo): Future[Seq[Row]] =
    step match {
      case s: RenameStep    => Future.successful(PipelineStepHandlers.applyRename(rows, s.config))
      case s: FilterStep    => Future.successful(PipelineStepHandlers.applyFilter(rows, s.config))
      case s: JoinStep      => PipelineStepHandlers.applyJoin(rows, s.config, dataSourceRepo)
      // ...
    }
}
object PipelineStepHandlers {
  def applyFilter(rows: Seq[Row], cfg: FilterConfig): Seq[Row] = ...
  // typed signatures — no JsObject crossing boundaries
}
```

Sealed-trait exhaustiveness: `step match { ... }` over the sealed ADT means the compiler enforces handler coverage. Adding an 11th step kind without adding its handler fails compilation — exactly the safety property we're after.

### 3. Engine boundary type — `Row` vs `Map[String, Any]`

Today the engine uses `Seq[Map[String, Any]]`. Don't change this here — that's a separate concern (columnar/streaming engine, much larger). The ADT change is independent of the row representation.

Use a local type alias `type Row = Map[String, Any]` for readability without committing to a new model.

### 4. PipelineRunService boundary

Today `PipelineRunRoutes` carries:
1. Validation (pipeline exists, data source exists, source type supported)
2. Pre-execution (insert run record, prune old runs)
3. Execution dispatch (in-process for static/csv, Spark for rest/sql — though Spark path currently 422s on rest/sql)
4. SSE event publication via `PipelineRunRegistry`
5. Result fetch + serialization

Service boundary:
- `PipelineRunService.submit(pipelineId, dry, user): Future[Either[ServiceError, RunSubmitResponse]]` — owns 1, 2, 3, 4
- `PipelineRunService.status(runId)`, `.result(runId)`, `.history(pipelineId)` — read-side methods
- SSE registry stays in the service (it's a runtime-state component, not HTTP)
- Routes only handle HTTP parsing + response mapping

### 5. Route file decomposition

Target shape:
```
api/routes/PipelineRunSubmitRoutes.scala       — POST /api/pipelines/:id/run
api/routes/PipelineRunStatusRoutes.scala       — GET .../runs/:runId/status, .../result
api/routes/PipelineRunHistoryRoutes.scala      — GET /api/pipelines/:id/runs
api/routes/PipelineRunStreamRoutes.scala       — SSE /api/pipelines/:id/events
```

Aggregator route in `ApiRoutes.scala` composes them. Each file independently constructible with `PipelineRunService`.

**Executor flexibility:** if a different partitioning reads more naturally (e.g. all run-read endpoints in one file), make that call and explain in the report. Per-file ≤ 150 lines is the hard constraint.

### 6. Wire-shape evolution: scope and breaking-change list

Breaking changes (frontend ships in same PR):

| Endpoint | Field | Before | After |
|---|---|---|---|
| `POST /api/pipelines/:id/steps` (request) | step body | `{ op: string, config: string }` | `{ type: string, config: object }` |
| `PATCH /api/pipeline-steps/:id` (request) | partial step | `{ op?: string, config?: string, position?: number }` | `{ type?: string, config?: object, position?: number }` (cross-type 400) |
| `GET /api/pipelines/:id/steps` (response) | step list | `{ op, config: string, ... }` | `{ type, config: object, ... }` |
| `GET /api/pipelines/:id/analyze` (response) | per-step | `{ op, config: string, ... }` | `{ type, config: object, ... }` |

Non-breaking:
- Run endpoints (`/run`, `/runs/:runId/status`, etc.) — shapes unchanged, this is a server-side restructure
- Pipeline CRUD (`/api/pipelines`) — unchanged
- DB schema — unchanged

### 7. `AllowedOps` removal

Today: hard-coded `Set[String]` in `PipelineService` companion. Drifted (missing `"aggregate"`).

After: `PipelineStepKind.All: Set[String]` lives next to the ADT and is the single source of truth. `PipelineService.addStep` / `updateStep` accept typed configs via the protocol layer; protocol's discriminator dispatch enforces validity at the JSON-unmarshalling boundary. Service-layer enum check is no longer needed — invalid `type` strings fail at unmarshalling.

This eliminates the bug class.

### 8. Config codec — typed parse with no legacy tolerance

CS2c-2 left a small "legacy tolerance" path in `DataSourceConfigCodec` for rows pre-dating the typed shape. For PipelineStep, the config has always been JSON text in `pipeline_steps.config` — the typed-codec just needs to parse known shapes per kind. No legacy fallback needed.

Codec API:
```scala
object PipelineStepConfigCodec {
  def decode(kind: String, configJson: String): Try[PipelineStepConfig]
  def encode(config: PipelineStepConfig): String
}
```

### 9. Test parity strategy

`InProcessPipelineEngineSpec` (703L) is the load-bearing parity gate. Strategy:
1. Update test fixtures to construct typed step ADT instances rather than `PipelineStepRow` with stringified config
2. Run the full file; any green→red transition is a behavior regression and a blocker
3. Add focused per-kind tests in `domain/PipelineStepSpec.scala` for ADT shape (kind correctness, pattern-match exhaustiveness) — these are lightweight, ADT-shape-only
4. Add `api/protocols/PipelineStepProtocolSpec.scala` for round-trip per kind + cross-type-patch rejection

### 10. Frontend impact map

```
frontend/src/types/models.ts              — PipelineStep union (10 subtypes), AnalyzeStepResult union, configs typed
frontend/src/features/pipelines/pipelinesSlice.ts       — thunk payloads use typed config
frontend/src/services/pipelineService.ts                — request bodies match new wire shape
frontend/src/components/PipelineDetailPage.tsx          — step list rendering branches on step.type
frontend/src/components/CreatePipelineModal.tsx         — step creation flow
frontend/src/components/StepCard.tsx (if exists)        — per-step UI
frontend/src/components/StepEditor*.tsx                 — per-kind config editors
frontend/src/features/toasts/toastListeners.ts          — only if it inspects step.op (likely no)
```

Remove every `JSON.parse(step.config)` / `JSON.stringify` site — `config` is now an object.

### 11. File-size targets (CS2c-3a)

| File | Target | Today | Plan |
|---|---|---|---|
| `InProcessPipelineEngine.scala` | ≤ 250 | 457 | Dispatch + thin shells; per-kind logic in `PipelineStepHandlers` |
| `PipelineRunRoutes.scala` | deleted | 380 | Split into 4 route files ≤ 150 each |
| `PipelineRunService.scala` | ≤ 300 | new | Owns run-lifecycle logic |
| `PipelineProtocol.scala` | ≤ 250 | 143 | May grow; split `PipelineStepProtocol.scala` if needed |
| `PipelineStepHandlers.scala` | ≤ 300 | new | Could exceed if handler logic balloons; split per-handler files if >300 |
| `PipelineService.scala` | ≤ 300 | 202 | Minor shrink (lose `AllowedOps`, accept typed configs) |
| `model.scala` | ≤ 250 | 301 | Falls back under budget once PipelineStep case class moves to `Pipeline.scala` |

### 12. Test count baseline

Today: 1195 total (531 sbt + 664 Jest from CS2c-2 close). Expect:
- sbt: +25–30 (per-kind protocol round-trips, config codec, PipelineRunService extraction)
- Jest: +5–10 (slice/service refactors mostly preserve existing coverage)

Regression count: 0.

## Smoke validation (evaluator Phase 3)

8-step Playwright flow:
1. Login as `matt@helio.dev`
2. Navigate to Pipelines page
3. Create new pipeline against an existing CSV/Static DataSource
4. Add 3 steps (filter, sort, limit) via the modal — verify typed config in network payloads
5. Open analyze view — verify each step renders with typed config (no JSON.parse errors)
6. Click Dry Run — verify rows render
7. Click Run — verify run completes, result table renders
8. Refresh page — verify step list re-loads with typed config

Negative-path inspection:
- Attempt cross-type PATCH via DevTools — expect 400 with clear message
- Inspect Network panel: confirm `config` is an object, not a string, in both request and response bodies
