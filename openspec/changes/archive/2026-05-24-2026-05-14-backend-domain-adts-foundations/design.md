# Design — backend-domain-adts (CS2c series)

> **Scope note (added when CS2c was split):** This OpenSpec change (`backend-domain-adts-foundations`) only delivers the foundations — `PipelineRunId` value class + ID segments + pipeline repo signature narrowing. The architectural design below covers the full CS2c series (Panel + DataSource + PipelineStep ADTs + wire shape evolution + engine split + run-lifecycle decomp + frontend lockstep). CS2c-2 will inherit this design for the DataSource ADT; CS2c-3 will inherit it for PipelineStep + Panel ADTs. Sections about ADT package layout, wire shape transition, polymorphic methods, frontend coordination, and Playwright smoke are forward-looking — only the foundations section applies to this PR.

## Package layout

### Backend new files

```
backend/src/main/scala/com/helio/domain/
├── model.scala                    (shrunk — common types only: IDs, ResourceMeta, ...)
├── Panel.scala                    (sealed trait Panel + 7 subtypes)
├── DataSource.scala               (sealed trait DataSource + 4 subtypes; configs co-located)
└── pipeline/
    ├── PipelineStep.scala         (sealed trait PipelineStep + 10 subtypes)
    └── steps/
        ├── RenameStep.scala
        ├── FilterStep.scala
        ├── ComputeStep.scala
        ├── GroupByStep.scala
        ├── AggregateStep.scala
        ├── CastStep.scala
        ├── JoinStep.scala
        ├── SelectStep.scala
        ├── LimitStep.scala
        └── SortStep.scala

backend/src/main/scala/com/helio/domain/
└── InProcessPipelineEngine.scala  (slimmed — dispatcher only, ≤ 250 lines)

backend/src/main/scala/com/helio/services/
└── PipelineRunService.scala       (new — run lifecycle moved from PipelineRunRoutes)
```

Each step file holds `case class XxxStep(...) extends PipelineStep` + its `XxxConfig` case class + its `apply` method. The engine becomes a fold over `pipeline.steps`, each step dispatching polymorphically.

### Frontend changes

```
frontend/src/types/models.ts          (Panel/DataSource/PipelineStep → discriminated unions)
frontend/src/slices/panelsSlice.ts    (typed thunks per subtype where needed)
frontend/src/slices/dataSourcesSlice.ts
frontend/src/slices/pipelinesSlice.ts
frontend/src/components/panels/*      (renderers consume specific subtype)
frontend/src/components/sources/*     (editors per source subtype)
frontend/src/components/pipelines/*   (step editors per step subtype)
```

No new directory structure (that's CS3). Just type and consumer updates in their current locations.

## Wire shape transition spec

### Panel

**Request bodies and responses are discriminated unions** with a `type` field naming the subtype and a `config` object holding subtype-specific fields. Common fields (`id`, `dashboardId`, `title`, `appearance`, `meta`, `ownerId`) sit at the top level.

| Subtype  | `type` value | `config` keys |
|---|---|---|
| MetricPanel    | `"metric"`   | `typeId?`, `fieldMapping?` |
| ChartPanel     | `"chart"`    | `typeId?`, `fieldMapping?` |
| TablePanel     | `"table"`    | `typeId?`, `fieldMapping?` |
| TextPanel      | `"text"`     | `content` |
| MarkdownPanel  | `"markdown"` | `content` |
| ImagePanel     | `"image"`    | `imageUrl`, `imageFit?` |
| DividerPanel   | `"divider"`  | `orientation`, `weight`, `color?` |

### PATCH semantics (preserves `Option[Option[_]]`)

PATCH on a panel is **typed to the subtype** — you can only PATCH a `MetricPanel`-shaped payload onto a metric panel. The patch body uses an explicit `JsNull` to clear a nullable field (the current "explicit-null" distinction):

```json
PATCH /api/panels/p1
{
  "type": "metric",
  "title": "Revenue (Q1)",
  "config": {
    "typeId": null,            // explicit-null clears the binding
    "fieldMapping": { ... }    // present-value sets it
    // omitted keys leave the field untouched
  }
}
```

If a client tries to PATCH with the wrong `type` discriminator, the route returns 400. **Type changes (metric → image) require delete + create** — keeps the ADT honest and avoids a wide cross-subtype validation matrix. This is a small behavior change but the UI never offered cross-type conversion anyway; verify the modal flows.

### DataSource

| Subtype       | `type` value | `config` shape |
|---|---|---|
| CsvSource     | `"csv"`     | `{ filename: string, columns: ... }` |
| RestSource    | `"rest_api"` | `RestApiConfig` |
| SqlSource     | `"sql"`     | `SqlSourceConfig` |
| StaticSource  | `"static"`  | `{ rows: Array<...> }` |

### PipelineStep

| Subtype       | `type` value | `config` shape |
|---|---|---|
| RenameStep    | `"rename"`    | `{ mapping: { [oldName: string]: string } }` |
| FilterStep    | `"filter"`    | `{ field, op, value }` |
| ComputeStep   | `"compute"`   | `{ field, expression }` |
| GroupByStep   | `"groupby"`   | `{ fields: string[], aggregations: ... }` |
| AggregateStep | `"aggregate"` | `{ groupBy: string[], aggs: ... }` |
| CastStep      | `"cast"`      | `{ field, to: 'string' \| 'integer' \| ... }` |
| JoinStep      | `"join"`      | `{ dataSourceId, on: { left, right }, kind: 'inner' \| 'left' }` |
| SelectStep    | `"select"`    | `{ fields: string[] }` |
| LimitStep     | `"limit"`     | `{ n: number }` |
| SortStep      | `"sort"`      | `{ field, direction: 'asc' \| 'desc' }` |

Exact config shapes mirror what the engine consumes today; the goal is type-safety on the wrapper, not redesigning the per-op semantics.

## Polymorphic method strategy

### Panel

```scala
sealed trait Panel {
  // common fields ...
  def isDataBound: Boolean
  def buildQuery: Option[PanelQuery]
}
sealed trait BoundPanel extends Panel {
  def typeId: Option[DataTypeId]
  def fieldMapping: Option[JsValue]
  final def isDataBound: Boolean = true
  final def buildQuery: Option[PanelQuery] = typeId.map { _ => /* current logic */ }
}
sealed trait UnboundPanel extends Panel {
  final def isDataBound: Boolean = false
  final def buildQuery: Option[PanelQuery] = None
}
final case class MetricPanel(...) extends BoundPanel
final case class ChartPanel(...)  extends BoundPanel
final case class TablePanel(...)  extends BoundPanel
final case class TextPanel(...)   extends UnboundPanel
// ... etc
```

The `BoundPanel` / `UnboundPanel` intermediate traits emerge from CS2b's `resolveBindingsForRead` already needing to fan out only over bound panels. Keep them — they're the natural cleavage. The user said "common methods will reveal where intermediate traits belong" — these are those traits.

### DataSource

```scala
sealed trait DataSource {
  def id: DataSourceId; def name: String; def ownerId: UserId; def createdAt: Instant; def updatedAt: Instant
  def kind: String       // discriminator string for protocol layer
}
```

Each subtype's `kind` is constant (`"csv"`, `"rest_api"`, `"sql"`, `"static"`).

### PipelineStep

```scala
sealed trait PipelineStep {
  def id: PipelineStepId; def pipelineId: PipelineId; def position: Int
  def apply(rows: Seq[Map[String, Any]])(implicit ec: ExecutionContext, dataSourceRepo: DataSourceRepository): Future[Seq[Map[String, Any]]]
}
```

The engine's `applyStep` becomes a one-liner: `step.apply(rows)`. The 10 inline `applyX` methods move into `XxxStep.apply` and shrink the engine to its actual job (orchestration + error handling).

## DB row → typed ADT mapping

### `PanelRepository.rowToDomain`

Current row shape: `(id, dashboardId, title, type, appearance, typeId, fieldMapping, content, imageUrl, imageFit, dividerOrientation, dividerWeight, dividerColor, ...)`.

New mapping:
```scala
private def rowToDomain(row: Row): Panel = row.panelType match {
  case "metric"   => MetricPanel(row.id, ..., row.typeId, row.fieldMapping)
  case "chart"    => ChartPanel(...)
  case "table"    => TablePanel(...)
  case "text"     => TextPanel(...,    row.content.getOrElse(""))
  case "markdown" => MarkdownPanel(..., row.content.getOrElse(""))
  case "image"    => ImagePanel(...,   row.imageUrl.getOrElse(""), row.imageFit)
  case "divider"  => DividerPanel(...,
                       row.dividerOrientation.getOrElse("horizontal"),
                       row.dividerWeight.getOrElse(1),
                       row.dividerColor)
  case other      => throw new IllegalStateException(s"Unknown panel type in DB: $other")
}
```

**Defaults for legacy data** — production rows may have NULL where a new subtype requires a value (e.g., a divider row without orientation). Use sensible defaults at the row → ADT boundary to avoid backfill. The defaults match what the UI assumed today.

`domainToRow` does the inverse — flattens the subtype back to (`type`, plus the relevant subset of nullable columns).

### `DataSourceRepository.rowToDomain`

Today does its own JSON marshalling on `config`. After CS2c:
```scala
private def rowToDomain(row: Row): DataSource = row.sourceType match {
  case "csv"      => CsvSource(...,   row.config.convertTo[CsvSourceConfig])
  case "rest_api" => RestSource(...,  row.config.convertTo[RestApiConfig])
  case "sql"      => SqlSource(...,   row.config.convertTo[SqlSourceConfig])
  case "static"   => StaticSource(...)
  case other      => throw new IllegalStateException(s"Unknown data source type: $other")
}
```

This is the alignment item from CS2a's spinoff list.

### `PipelineStepRepository.rowToDomain`

Dispatches on `op` column, deserializes typed config:
```scala
private def rowToDomain(row: Row): PipelineStep = row.op match {
  case "rename"    => RenameStep(...,    row.config.parseJson.convertTo[RenameConfig])
  case "filter"    => FilterStep(...,    row.config.parseJson.convertTo[FilterConfig])
  ... // 10 cases
}
```

## Inner-vs-left-join policy

HEL-200 surfaced ambiguity around `JoinStep` default behavior. CS2c codifies:

**Default join `kind` is `"inner"`** when the field is absent. `"left"` must be explicit. Document this in the `JoinStep.scala` file header comment. Rationale: more conservative — an inner join with mismatched keys returns 0 rows, which is loudly broken; a left join silently emits nulls.

If existing rows in the DB have an absent `kind` and the historical behavior was `"left"`, then either (a) backfill those rows with `kind: "left"` in a tiny Flyway migration, or (b) keep the JSON-side absence default as `"left"` to preserve back-compat. Executor should grep production-shaped fixtures and decide; capture the decision in the design notes section of `JoinStep.scala`.

## Frontend coordination plan

### Type definitions

`frontend/src/types/models.ts` becomes:
```ts
type PanelBase = { id: string; dashboardId: string; title: string; appearance: PanelAppearance };
type MetricPanel    = PanelBase & { type: 'metric'; config: { typeId?: string; fieldMapping?: Record<string, string> } };
type ChartPanel     = PanelBase & { type: 'chart'; config: { typeId?: string; fieldMapping?: Record<string, string> } };
type TablePanel     = PanelBase & { type: 'table'; config: { typeId?: string; fieldMapping?: Record<string, string> } };
type TextPanel      = PanelBase & { type: 'text'; config: { content: string } };
type MarkdownPanel  = PanelBase & { type: 'markdown'; config: { content: string } };
type ImagePanel     = PanelBase & { type: 'image'; config: { imageUrl: string; imageFit?: string } };
type DividerPanel   = PanelBase & { type: 'divider'; config: { orientation: string; weight: number; color?: string } };
export type Panel = MetricPanel | ChartPanel | TablePanel | TextPanel | MarkdownPanel | ImagePanel | DividerPanel;
```

Same pattern for `DataSource` and `PipelineStep`.

### Consumer update strategy

The TypeScript compiler will flag every consumer that accesses fields that no longer exist on the union. Fix each by:
1. **Narrow before access**: `if (panel.type === 'image') panel.config.imageUrl` instead of `panel.imageUrl`.
2. **Type-specific helpers**: extract `isBoundPanel(p: Panel): p is MetricPanel | ChartPanel | TablePanel` for cases where 3 subtypes share behavior.
3. **Renderers stay flat**: a single `<PanelView panel={panel} />` that internally switches on `panel.type` and renders the subtype renderer.

### Modal flows

- **Panel creation modal** — type selector → typed config form (one per type). Already structured this way in the UI; just bind to the new TS types.
- **Panel detail modal** — discriminated rendering. Locked from cross-type conversion (matches backend restriction).
- **Data source create/edit** — same. The source type selector picks the subtype, the config form is typed.

## Test strategy

### Backend

- **Every existing test passes** — many are integration tests against the routes; they exercise the full round-trip. Update assertion payloads to the new wire shape.
- **New ADT-specific tests**:
  - `PanelSpec.scala` — pattern match coverage, `buildQuery` correctness per subtype
  - `DataSourceSpec.scala` — same
  - `PipelineStepSpec.scala` — each subtype's `apply` returns correct rows against canned input
- **Repo round-trip tests** — `PanelRepositorySpec.scala` already exists; verify each subtype creates → reads → updates correctly through the new `rowToDomain` / `domainToRow`.

### Frontend

- Jest tests for Redux slices stay green against the new types
- Snapshot tests for renderers regenerate
- New unit tests for type narrowing helpers

### Manual Playwright smoke (8 steps)

The evaluator's Phase 3 runs this against `DEV_PORT=5174` / `BACKEND_PORT=8081`:

1. Login (`matt@helio.dev` / `heliodev123`)
2. Create dashboard
3. Create one panel of each subtype (metric, chart, text, table, divider, image, markdown)
4. Verify each panel renders correctly with the new wire shape
5. PATCH a metric panel's `config.typeId` — confirms typed PATCH dispatch
6. Snapshot export → import — full round-trip through the new shape
7. Create CSV / REST / Static data source — each through the new DataSource ADT
8. Create pipeline with one step of 3 different types + run — confirms engine split didn't break run lifecycle

Any failure = BLOCKER.

## Coordination with parallel work

### HEL-256 (P0 data source schema disappearance)

If discovered as side-PR during CS2c design, it lands first off main, then gets merged forward into CS2c. The DataSource ADT remodel makes the fix more obvious — if `StaticSource` doesn't carry its schema in its config, that's the bug.

### HEL-242 (P0 panel binding)

The polymorphic `Panel.buildQuery` makes this a non-issue — `MetricPanel`, `ChartPanel`, `TablePanel` have `typeId` + `fieldMapping`; the unbound subtypes don't. Verify post-CS2c that the symptom is gone and close HEL-242 with a reference to the CS2c PR.

### HEL-265 (ACL pushdown)

Explicitly NOT in CS2c. CS2c does touch `rowToDomain` (for ADT discriminator unpacking) but not the SELECT-side ACL injection.

## Open question — pipeline run lifecycle (resolved in design)

**Q**: Where does the run lifecycle live? Today it's in `PipelineRunRoutes.scala` (377 lines) interleaved with HTTP shell. After CS2c, the engine is polymorphic on step ADT, but the run lifecycle (start, status update, persistence, error capture) is orthogonal.

**A**: Create `services/PipelineRunService.scala` matching CS2b shape. Methods: `startRun(pipelineId, user)`, `getRun(id, user)`, `listRuns(pipelineId, user)`, `cancelRun(id, user)`. The engine becomes a pure function the service calls. Route file ≤ 150 lines.

## File-size targets

| File | Today | Target |
|---|---:|---:|
| `domain/model.scala`              | 331 | ≤ 200 (after extracting Panel.scala, DataSource.scala, pipeline/PipelineStep.scala) |
| `domain/Panel.scala`              | new | ≤ 200 |
| `domain/DataSource.scala`         | new | ≤ 150 |
| `domain/pipeline/PipelineStep.scala` | new | ≤ 80 (trait only; subtypes in step files) |
| `domain/pipeline/steps/*.scala`   | new | ≤ 80 each (10 files) |
| `domain/InProcessPipelineEngine.scala` | 458 | ≤ 250 |
| `api/routes/PipelineRunRoutes.scala` | 377 | ≤ 150 |
| `services/PipelineRunService.scala`  | new | ≤ 250 |
| `api/protocols/PanelProtocol.scala`  | 211 | ≤ 250 (discriminator JSON formatters add lines) |
| `api/protocols/DataSourceProtocol.scala` | 166 | ≤ 200 |
| `infrastructure/PanelRepository.scala` | 305 | ≤ 350 (typed mapping adds lines but is bounded) |

Aggregator files (`JsonProtocols.scala`) stay under 80.

## Rollback plan

If a critical bug surfaces after merge:
1. Revert the merge commit (touches both backend and frontend in one PR, so revert is clean).
2. The DB shape is unchanged — no migration to roll back.
3. Investigate, fix, re-land.

This is the second reason we keep the DB table flat: rollback is a single git revert.
