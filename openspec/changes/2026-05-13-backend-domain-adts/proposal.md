# Backend domain ADTs — Change Set 2c of HEL-236

## Why

After CS1 (protocols split), CS2a (routes decompose), and CS2b (service layer), the backend is structurally clean but the **domain model still leaks "PanelType / SourceType / op-string" enums through every method that touches it**. Every panel-handling code path looks like this today:

```scala
panel.panelType match {
  case PanelType.Metric   => doMetricThing(panel.typeId.get, panel.fieldMapping.get)
  case PanelType.Image    => doImageThing(panel.imageUrl.get, panel.imageFit.get)
  case PanelType.Divider  => doDividerThing(panel.dividerOrientation.get, panel.dividerWeight.get, panel.dividerColor.get)
  case PanelType.Text     => doTextThing(panel.content.get)
  ...
}
```

The `Panel` case class is a **wide bag of nullable fields** (`typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`, `dividerColor`). Every consumer must remember which fields go with which `PanelType`, and the type system gives no protection. **HEL-242** (Panel ↔ DataType binding bug) is the recurring symptom — a switch-case forgot a discriminator branch.

`DataSource` has the same problem: a `JsValue config` blob carrying CSV / REST / SQL / Static shapes, parsed at every call site via `config.convertTo[CsvSourceConfig]` or similar.

`PipelineStep.op` is a raw `String`; the engine dispatches on string match (`"filter" => applyFilter`, `"join" => applyJoin`, ...).

CS2c replaces all three with sealed-trait ADTs:

- **`Panel`** — 7 subtypes: `MetricPanel`, `ChartPanel`, `TablePanel`, `TextPanel`, `MarkdownPanel`, `ImagePanel`, `DividerPanel`. Each carries only the fields it needs.
- **`DataSource`** — 4 subtypes: `CsvSource`, `RestSource`, `SqlSource`, `StaticSource`. Config becomes a typed field on the subtype.
- **`PipelineStep`** — 10 subtypes mirroring the engine ops: `RenameStep`, `FilterStep`, `ComputeStep`, `GroupByStep`, `AggregateStep`, `CastStep`, `JoinStep`, `SelectStep`, `LimitStep`, `SortStep`. Config becomes typed per subtype.

**The wire shape evolves alongside.** Each subtype emits only its own fields, with a `type` discriminator. The frontend types become discriminated unions and consumers update in the same PR.

## What changes

### Backend domain ADTs

```scala
// Panel ADT
sealed trait Panel {
  def id: PanelId
  def dashboardId: DashboardId
  def title: String
  def meta: ResourceMeta
  def appearance: PanelAppearance
  def ownerId: UserId
}

final case class MetricPanel(...,   typeId: Option[DataTypeId], fieldMapping: Option[JsValue]) extends Panel
final case class ChartPanel(...,    typeId: Option[DataTypeId], fieldMapping: Option[JsValue]) extends Panel
final case class TablePanel(...,    typeId: Option[DataTypeId], fieldMapping: Option[JsValue]) extends Panel
final case class TextPanel(...,     content: String)                                            extends Panel
final case class MarkdownPanel(..., content: String)                                            extends Panel
final case class ImagePanel(...,    imageUrl: String, imageFit: Option[String])                 extends Panel
final case class DividerPanel(...,  orientation: String, weight: Int, color: Option[String])    extends Panel

// DataSource ADT
sealed trait DataSource { def id: DataSourceId; def name: String; def ownerId: UserId; def createdAt: Instant; def updatedAt: Instant }
final case class CsvSource(...,    config: CsvSourceConfig)    extends DataSource
final case class RestSource(...,   config: RestApiConfig)      extends DataSource
final case class SqlSource(...,    config: SqlSourceConfig)    extends DataSource
final case class StaticSource(...) extends DataSource

// PipelineStep ADT (10 subtypes mirroring engine ops)
sealed trait PipelineStep { def id: PipelineStepId; def pipelineId: PipelineId; def position: Int }
final case class RenameStep(...,    config: RenameConfig)    extends PipelineStep
final case class FilterStep(...,    config: FilterConfig)    extends PipelineStep
final case class ComputeStep(...,   config: ComputeConfig)   extends PipelineStep
final case class GroupByStep(...,   config: GroupByConfig)   extends PipelineStep
final case class AggregateStep(..., config: AggregateConfig) extends PipelineStep
final case class CastStep(...,      config: CastConfig)      extends PipelineStep
final case class JoinStep(...,      config: JoinConfig)      extends PipelineStep
final case class SelectStep(...,    config: SelectConfig)    extends PipelineStep
final case class LimitStep(...,     config: LimitConfig)     extends PipelineStep
final case class SortStep(...,      config: SortConfig)      extends PipelineStep
```

Polymorphic methods become trait-level dispatch:
- `Panel.isDataBound: Boolean` (only Metric / Chart / Table return `true`)
- `Panel.buildQuery: Option[PanelQuery]` (no more wide match)
- `DataSource.kind: String` (replaces `SourceType.asString(d.sourceType)`)
- `PipelineStep.apply(rows: Seq[Map[String, Any]])(implicit ec, ds): Future[Seq[Map[String, Any]]]` — the engine becomes a fold over typed steps

### Wire shape evolution

**Today (flat with nulls):**
```json
{
  "id": "p1", "type": "metric", "title": "Revenue",
  "typeId": "dt-1", "fieldMapping": { ... },
  "content": null, "imageUrl": null, "imageFit": null,
  "dividerOrientation": null, "dividerWeight": null, "dividerColor": null
}
```

**After CS2c (discriminated union, only relevant fields):**
```json
{
  "type": "metric",
  "id": "p1", "title": "Revenue",
  "config": { "typeId": "dt-1", "fieldMapping": { ... } }
}
```

The `type` field is the discriminator. Subtype-specific fields live in `config` — this keeps the wire shape clean and shields cross-subtype field-name collisions.

### Frontend types updated in lockstep

`frontend/src/types/models.ts` today:
```ts
export interface Panel { type: PanelType; title: string; typeId?: string; ...nulls... }
```

After CS2c:
```ts
export type Panel =
  | { type: 'metric'; id: string; title: string; appearance: PanelAppearance; config: { typeId?: string; fieldMapping?: unknown } }
  | { type: 'chart';  ... }
  | { type: 'text';   id: string; title: string; appearance: PanelAppearance; config: { content: string } }
  | { type: 'image';  id: string; title: string; appearance: PanelAppearance; config: { imageUrl: string; imageFit?: string } }
  | { type: 'divider'; id: string; title: string; appearance: PanelAppearance; config: { orientation: string; weight: number; color?: string } }
  | ... ;
```

Same pattern for `DataSource` and `PipelineStep`. All Redux slice updates, panel renderers, modal forms, and source editors update in the same PR.

### Bundled adjacent work

1. **`InProcessPipelineEngine.scala` split** — currently 459 lines of a switch-case dispatcher with 10 `applyX` methods inline. After CS2c: thin `InProcessPipelineEngine` dispatcher (~80 lines) delegating to `PipelineStep.apply` (per-step polymorphic).
2. **`PipelineRunRoutes.scala` decomp** — 377 lines of route + lifecycle orchestration. Move lifecycle into `PipelineRunService`; route ≤ 150 lines.
3. **`DataSourceRepository.rowToDomain` alignment** — discriminator unpacking now reads the `source_type` column and dispatches to the typed subtype constructor.
4. **Inner-vs-left-join policy codified** — pick one, document in `CONTRIBUTING.md` as an ADR-style note (or as a comment in `JoinStep`).
5. **Pipeline repo ID narrowing** — `PipelineRepository`, `PipelineStepRepository`, `PipelineRunRepository` accept value-class IDs everywhere.
6. **`PipelineStepIdSegment` + `PipelineRunId` + segment** — add to `IdParsing.scala`.
7. **`PipelineRunId` value class** — introduce in `domain/model.scala`.

### Things that DO NOT change in CS2c

- **DB table shape** — `panels` table still has one row per panel with `type` column + nullable subtype-specific columns. ADT layer maps rows to typed subtypes on read.
- **Existing endpoints** — same paths, same methods. Only the request/response shapes change.
- **AuthService and auth flows** — security-sensitive; untouched.
- **`domain/ExpressionEvaluator.scala`** — pipeline expression engine, untouched (only the engine's per-op dispatcher moves).
- **Existing OpenSpec / schemas / OpenAPI specs** — UPDATED (new request/response shapes) but the overall endpoint catalogue is unchanged.

## Impact

- **Specs affected**: `schemas/panel*.json`, `schemas/data-source*.json`, `schemas/pipeline-step*.json` (or equivalents) all evolve. `openspec/specs/api/v1.yaml` updates with discriminator-based response schemas.
- **Added**: `domain/Panel.scala` (split from `model.scala`), `domain/DataSource.scala`, `domain/PipelineStep.scala`, per-op `domain/pipeline/steps/*.scala` files (~10 small files), `PipelineRunService.scala`.
- **Modified**: `infrastructure/PanelRepository.scala`, `infrastructure/DataSourceRepository.scala`, `infrastructure/PipelineStepRepository.scala` (typed row mapping). `domain/InProcessPipelineEngine.scala` (slim dispatcher). `api/protocols/PanelProtocol.scala`, `DataSourceProtocol.scala`, `PipelineStepProtocol.scala` (discriminated union formatters). `services/PanelService.scala`, `DataSourceService.scala`, `PipelineService.scala` (polymorphic dispatch). All consuming routes (PATCH input shape change for Panel, etc.).
- **Frontend modified**: `types/models.ts`, `slices/panelsSlice.ts`, `slices/dataSourcesSlice.ts`, `slices/pipelinesSlice.ts`, all panel renderers (`MetricPanelView`, `ChartPanelView`, etc.), panel detail modal, panel creation modal, source editors, step editors.
- **Tests**: every existing test continues to pass against the new wire shape. New ADT-specific tests for polymorphic dispatch. Frontend Jest tests updated for the new TS types.
- **DB**: no migration. The `type` / `source_type` / `op` columns become the discriminator; nullable subtype columns continue to map by subtype on read.

## Out of scope

- Frontend structure (CS3) and decomposition (CS4) — separate PRs.
- ACL pushdown to repo/SQL layer (HEL-265) — backlogged.
- HEL-242 direct fix — verify post-hoc.
- HEL-256 — parallel side-PR off main.
- New endpoints, new fields, new connectors.
- Per-subtype DB tables.

## Acceptance criteria

- [ ] `Panel`, `DataSource`, `PipelineStep` are all sealed traits with strict per-subtype case classes
- [ ] No `match { case PanelType.X => ... }` switch-cases remain in route / service / engine code (one pattern match each in JSON formatter + repo `rowToDomain` is expected and fine)
- [ ] Wire shape is a discriminated union: every JSON-emitting code path produces `{ "type": "...", ...subtype fields... }` and accepts the same on input
- [ ] Frontend `Panel` / `DataSource` / `PipelineStep` types are discriminated unions; all consumers compile against the new types
- [ ] `InProcessPipelineEngine.scala` ≤ 250 lines after split
- [ ] `PipelineRunRoutes.scala` ≤ 150 lines after decomp
- [ ] Every backend file ≤ 300 lines (services) / ≤ 250 lines (other source) / ≤ 150 lines (routes) per CONTRIBUTING budget
- [ ] `sbt test` + frontend `npm test` + lint + format + schema check + OpenSpec check + scala-quality hook all green
- [ ] Manual Playwright smoke: 8-step flow (login → dashboard → one panel of each subtype → PATCH metric → snapshot round-trip → CSV/REST/Static source → pipeline + run)
- [ ] No FQN violations (pre-commit hook enforces)

## Risk

- **Wire shape break.** This is the first PR in HEL-236 that intentionally evolves the contract. Every JSON-emitting and JSON-consuming path on both sides must be audited. Mitigation: explicit cross-tier task list + smoke test + evaluator Phase 3 Playwright.
- **`Option[Option[_]]` PATCH semantics preservation.** Today, `PanelService.update` uses `ResolvedPanelPatch` to distinguish absent / explicit-null / value. The ADT remodel changes the patch shape (typed sub-PATCHes per panel type), but the semantic distinction may need to persist for nullable fields on bound panels (e.g., `typeId`, `fieldMapping`). Audit explicitly.
- **AuthService blast radius.** Untouched in CS2c — but the ADT changes might shift formatter imports. `git diff services/AuthService.scala` should show no changes; verify before pushing.
- **Step ADT scope.** 10 subtypes is a lot. Mitigation: each step subtype is small (config + apply method); the savings on the engine side (no more inline `applyX`) more than offset the new file count.
- **DB row → typed ADT mapping bugs.** A new mistake-surface. Mitigation: existing integration tests in `*RoutesSpec.scala` exercise round-trip create → read for every panel/source/step subtype. Add focused unit tests on `rowToDomain` if gaps surface.
- **Future preservation pressure on CS3 / CS4.** The discriminated-union frontend types become the source of truth for CS3 / CS4 component design. Get the type shape right — a sloppy `config: unknown` defeats the purpose.
