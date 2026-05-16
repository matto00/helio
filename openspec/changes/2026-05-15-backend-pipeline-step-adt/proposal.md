# Proposal — backend-pipeline-step-adt (CS2c-3a)

## Why

Three concrete problems converge on PipelineStep:

1. **Wide-flat case class with stringly-typed op + stringly-typed config blob.** `PipelineStep(id, pipelineId, position, op: String, config: String, ...)` shifts all type discipline to runtime. The engine's `applyStep` has an 11-case `match` on `op: String`. `PipelineService.AllowedOps` re-enumerates the same set as a static `Set[String]` — and is **already drifted**: it lists 9 ops but the engine accepts 10 (missing `"aggregate"`). This drift is exactly the bug class sealed-trait ADTs eliminate at compile time.

2. **Files over budget, hot-path concentration.**
   - `InProcessPipelineEngine.scala`: 457 lines. Soft budget 250.
   - `PipelineRunRoutes.scala`: 380 lines. Routes target ≤ 150. The route file inlines run-lifecycle logic (insert run record, prune old runs, dispatch to in-process vs spark, publish SSE events) that should live in a service.
   - Both files are pipeline-runtime hot paths — the place where stability and reviewability matter most.

3. **Wire-shape stringification at the boundary.** Today the API contract for `/api/pipeline-steps/:id` round-trips `config: String` — a JSON-stringified blob inside a JSON envelope. Frontend has to `JSON.parse(step.config)` everywhere it reads config and `JSON.stringify` on write. CS2c-2 established the template: replace stringly-typed `op` with a `type` discriminator and replace `config: String` with `config: JsObject` typed per-subtype. Frontend gets a typed discriminated union — no more parse/stringify dance, no more "what shape is this op's config" guesswork.

CS2c-3a covers the Pipeline half of the original CS2c-3 scope. CS2c-3b (Panel ADT) follows after this merges.

## What changes

### Backend domain
- New `domain/Pipeline.scala` (or `domain/PipelineStep.scala`):
  ```scala
  sealed trait PipelineStep {
    def id: PipelineStepId
    def pipelineId: PipelineId
    def position: Int
    def kind: PipelineStepKind
    def createdAt: Instant
    def updatedAt: Instant
  }
  object PipelineStepKind {
    val Rename    = "rename"
    val Filter    = "filter"
    val Join      = "join"
    val Compute   = "compute"
    val GroupBy   = "groupby"
    val Cast      = "cast"
    val Select    = "select"
    val Limit     = "limit"
    val Sort      = "sort"
    val Aggregate = "aggregate"
    val All: Set[String] = Set(Rename, Filter, Join, Compute, GroupBy, Cast, Select, Limit, Sort, Aggregate)
  }
  final case class RenameStep(   id, pipelineId, position, config: RenameConfig,   createdAt, updatedAt) extends PipelineStep
  final case class FilterStep(   id, pipelineId, position, config: FilterConfig,   createdAt, updatedAt) extends PipelineStep
  final case class JoinStep(     id, pipelineId, position, config: JoinConfig,     createdAt, updatedAt) extends PipelineStep
  final case class ComputeStep(  id, pipelineId, position, config: ComputeConfig,  createdAt, updatedAt) extends PipelineStep
  final case class GroupByStep(  id, pipelineId, position, config: GroupByConfig,  createdAt, updatedAt) extends PipelineStep
  final case class CastStep(     id, pipelineId, position, config: CastConfig,     createdAt, updatedAt) extends PipelineStep
  final case class SelectStep(   id, pipelineId, position, config: SelectConfig,   createdAt, updatedAt) extends PipelineStep
  final case class LimitStep(    id, pipelineId, position, config: LimitConfig,    createdAt, updatedAt) extends PipelineStep
  final case class SortStep(     id, pipelineId, position, config: SortConfig,     createdAt, updatedAt) extends PipelineStep
  final case class AggregateStep(id, pipelineId, position, config: AggregateConfig,createdAt, updatedAt) extends PipelineStep
  ```
- Each config case class typed to the shape the engine consumes today (see `InProcessPipelineEngine.apply*` private methods for current accepted fields).
- Old flat `PipelineStep` case class deleted from `domain/model.scala`.

### Backend infrastructure (repo)
- `PipelineStepRepository.rowToDomain` dispatches on `op` column → typed subtype. DB table shape unchanged (`pipeline_steps.op` stays the discriminator column; `pipeline_steps.config` stores JSON text).
- `domainToRow` pattern-matches the subtype → `(op, configJson)` pair.
- A typed `PipelineStepConfigCodec` (mirror of `DataSourceConfigCodec`) parses the stored JSON text into typed configs at read time and writes typed configs to JSON text at write time.
- Repo signatures evolve from `(op: String, config: String)` to `(step: PipelineStep)` / `(config: PipelineStepConfig)` where natural.

### Backend protocol
- `api/protocols/PipelineProtocol.scala` (or new `PipelineStepProtocol.scala`):
  - `RootJsonFormat[PipelineStep]` discriminated on `type` field, with typed per-subtype `config` payload (no stringification)
  - `CreatePipelineStepRequest` and `UpdatePipelineStepRequest` shapes follow the discriminated-union pattern; cross-type PATCH (changing `type`) returns 400 with explicit message
  - `AnalyzeStepResponse` mirrors the same shape
- File-size check: split off `PipelineStepProtocol.scala` if the combined file exceeds 250 lines.

### Backend services
- `PipelineService.AllowedOps` deleted. Replaced by `PipelineStepKind.All` (sourced from sealed-trait subclasses).
- `PipelineService.addStep` / `updateStep` accept typed config and validate via the protocol/codec layer rather than string allow-list.
- New `services/PipelineRunService`:
  - `submitRun(pipelineId, dry: Boolean, user)` — pre-execution (insert run record + prune), dispatch (in-process vs spark) by source type, publish SSE events, return `RunSubmitResponse`
  - `getStatus(runId)`, `getResult(runId)`, `listHistory(pipelineId)`, `streamEvents(pipelineId)` — extracted from current route bodies
  - Lifts business logic out of route layer; routes become thin HTTP shells

### Backend routes
- `PipelineRunRoutes.scala` (380L) → decomposed into focused route files, each ≤ 150 lines. Likely shape:
  - `PipelineRunSubmitRoutes` — POST `/api/pipelines/:id/run`
  - `PipelineRunStatusRoutes` — GET `/api/pipelines/:id/runs/:runId/status`, GET `.../result`
  - `PipelineRunHistoryRoutes` — GET `/api/pipelines/:id/runs`
  - `PipelineRunStreamRoutes` — SSE endpoint
  - (Executor decides final partitioning based on natural per-endpoint seams.)
- `PipelineStepRoutes` updated to consume typed wire shape.
- All routes pure entity-unmarshal → service-call → complete.

### Spark submitter
- `SparkJobSubmitter.scala:152` pattern-match on `step.op: String` → ADT dispatch. Spark-side JSON serialization preserved (it's an external boundary; if the submitted JSON format changes, the Spark application code must update in lockstep — verify whether it deserializes typed or reads raw fields).

### Frontend
- `frontend/src/types/models.ts`:
  ```ts
  export type PipelineStep =
    | RenameStep | FilterStep | JoinStep | ComputeStep | GroupByStep
    | CastStep | SelectStep | LimitStep | SortStep | AggregateStep;
  interface BasePipelineStep { id: string; pipelineId: string; position: number; createdAt: string; updatedAt: string; }
  export interface RenameStep    extends BasePipelineStep { type: "rename";    config: RenameConfig; }
  export interface FilterStep    extends BasePipelineStep { type: "filter";    config: FilterConfig; }
  // ...one per kind
  ```
  Same shape for `AnalyzeStepResult`.
- `pipelinesSlice.ts`, `pipelineService.ts`, `PipelineDetailPage.tsx`, `CreatePipelineModal.tsx`, all step editor components updated to consume the discriminated union.
- Remove `JSON.parse(step.config)` / `JSON.stringify(config)` indirection — `config` is now a typed object.
- Narrowing helpers (`isFilterStep`, etc.) added only where 3+ consumers need the same narrow (CS2c-2 rule).

### Tests
- New `domain/PipelineStepSpec.scala` — per-subtype `kind` correctness + pattern-match coverage
- New `api/protocols/PipelineStepProtocolSpec.scala` — round-trip per subtype, cross-type-patch-rejection coverage
- Existing engine specs updated for ADT inputs; verify behavior parity for every kind
- New `services/PipelineRunServiceSpec.scala` extracted from route spec
- Repo specs updated for typed round-trip

### OpenSpec spec.md sync
- Find every `openspec/specs/*` file that references step request/response shapes (executor greps for `"op":`, `config:`, etc. inside pipeline/step contexts)
- Update with the new wire shape

## Wire-shape diff (illustrative)

**Before:**
```json
{
  "id": "step_abc",
  "pipelineId": "pl_123",
  "position": 0,
  "op": "filter",
  "config": "{\"combinator\":\"AND\",\"conditions\":[...]}"
}
```

**After:**
```json
{
  "id": "step_abc",
  "pipelineId": "pl_123",
  "position": 0,
  "type": "filter",
  "config": {
    "combinator": "AND",
    "conditions": [...]
  }
}
```

## Non-goals

- No DB schema migration. `pipeline_steps.op` stays the discriminator column; `pipeline_steps.config` continues to store JSON text. The ADT is a domain/wire concern.
- No Panel changes — CS2c-3b
- No snapshot import/export changes — CS2c-3b (Panel ADT depends)
- No new step ops — the 10 today (including `"aggregate"` already in engine) are exactly what ships
- No frontend feature-folder restructure — CS3
- No HEL-242 fix — depends on Panel ADT (CS2c-3b)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Engine handler split introduces behavior regression on a step kind | Existing `InProcessPipelineEngineSpec` (703L, 50+ cases) is the parity gate. Run the full file before merge; any green-to-red transition blocks |
| Spark side reads typed JSON from submitter and breaks on new shape | Inspect `SparkJobSubmitter` serialization. If Spark code consumes the JSON shape via typed deserialization, coordinate the format change; if it reads raw fields, ensure compatibility |
| Cross-type PATCH (frontend tries to change a filter into a sort) | Locked: backend returns 400 with explicit message (matches CS2c-2 policy) |
| `AllowedOps` drift recurrence | Allow-list now derived from sealed-trait subclasses; impossible to drift without adding/removing a subclass |
| Wire-shape break visible to any external API consumer | Document in PR description; this is intentional contract evolution (HEL-236 pattern) — frontend + backend ship together |
| `PipelineService` consumers (modal validation, etc.) break on typed configs | Frontend lockstep handles the modal path; backend service validation moves to the protocol layer |

## Out of scope (captured as spinoffs if surfaced)

- `Redactable` typeclass for credential fields in step configs (e.g. SQL passwords in `JoinConfig` if joining a SQL source) — defer until webhook secrets land (per CS2c-2 spinoff list)
- `PipelineStepProtocol` further split per-kind if file balloons — CS3-era cleanup
- Engine performance: in-process engine still processes Seq[Map[String, Any]]; columnar/streaming engine is a separate initiative

## Estimate

Comparable to CS2c-2 in surface count (~70 files) but lower wire-evolution risk (Pipeline UI is less central than DataSource flow). Engine split adds new files but is mechanical. Realistic: 1 executor cycle + 1 evaluator cycle + smoke.

## Cycle 3 scope addition (per-step-file refactor)

After cycles 1+2 landed and PR #151 was approved, a structural follow-up was
folded in before merge: the central `PipelineStepHandlers` object + central
`PipelineStepConfigCodec` are replaced by **self-contained per-step modules**
under `domain/steps/<Kind>Step.scala`. Each module owns:

- the typed `*Config` case class
- the `*Step` case class implementing a polymorphic `evaluate(rows, ctx)` method on the trait
- the JSON codec for its config (tolerant read + canonical write)
- a `PipelineStep.Companion` registered with `PipelineStep.Registry`

Trade-offs accepted:

1. **Uniform async signature.** Every step's `evaluate` returns `Future` and
   accepts a `PipelineExecutionContext`, even pure-sync steps (Select / Limit /
   Cast / etc.) which just wrap their result in `Future.successful` and ignore
   `ctx`. The cost is one line of boilerplate per sync step; the benefit is a
   single dispatch shape in the engine.
2. **`PipelineStep` is not `sealed`.** Scala 2's `sealed` constrains subclasses
   to the same compilation unit, which would defeat the per-file structure.
   Discipline is enforced via `PipelineStep.Registry` (which `PipelineStepKind.All`
   now derives from) plus an existing exhaustiveness test that enumerates the
   10 subtypes in a match block. Adding an 11th kind without updating the
   registry fails the kind-set parity test.
3. **`PipelineStepConfigCodec` kept as a thin facade.** Service + repository
   call sites continue to use `PipelineStepConfigCodec.{decode, encode,
   encodeConfig, encodeJsObject}`; the facade delegates to the per-step
   `companion`. This preserves the cycle-2 public surface while moving the
   per-kind tolerance defaults into their step files.

The wire shape, the DB shape, the cross-type PATCH lock, the analyze-layer
behaviour, and the entire frontend remain unchanged. The analyze-layer
stringly-typed carve-out (`validationError: "Unknown op: 'join'"` on the
analyze response) is explicitly **deferred** — folding `inferOutputSchema`
into the trait alongside `evaluate` would double the surface and risk the
cycle. Captured as a forward marker.

File-size targets met after cycle 3:

| File | Cycle 2 | Cycle 3 | Target |
|---|---:|---:|---:|
| `domain/Pipeline.scala` | 189 | (deleted) | n/a |
| `domain/PipelineStep.scala` | — | 150 | ≤ 250 |
| `domain/steps/<Kind>Step.scala` × 10 | — | 60–121 each | ≤ 200 |
| `domain/PipelineStepHandlers.scala` | 311 | (deleted) | n/a |
| `domain/PipelineRowJson.scala` | — | 77 | ≤ 100 |
| `domain/InProcessPipelineEngine.scala` | 145 | 124 | ≤ 250 |
| `api/protocols/PipelineStepConfigCodec.scala` | 264 | 115 | ≤ 250 |
| `api/protocols/PipelineStepProtocol.scala` | 176 | 178 | ≤ 250 |

Both cycle-2 soft overages (codec 264L, handlers 311L) close as a side effect.
