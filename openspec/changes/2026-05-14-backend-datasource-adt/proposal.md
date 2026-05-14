# Backend DataSource ADT — Change Set 2c-2 of HEL-236

## Why

Today `DataSource` is a wide flat case class:

```scala
final case class DataSource(
    id: DataSourceId,
    name: String,
    sourceType: SourceType,          // enum: RestApi | Csv | Static | Sql
    config: JsValue,                  // shape varies by sourceType, parsed at every call site
    createdAt: Instant,
    updatedAt: Instant,
    ownerId: UserId
)
```

Every consumer that needs the typed config has to `config.convertTo[CsvSourceConfig]` / `config.convertTo[RestApiConfig]` / `config.convertTo[SqlSourceConfig]` at the call site. The type system gives no guarantee that `sourceType = Sql` actually carries `SqlSourceConfig` in `config` — that contract is implicit and validated only at runtime. `services/DataSourceService.scala` and `services/SourceService.scala` together hold ~670 lines and a recurring `match { case Csv => ...; case RestApi => ...; ... }` pattern.

CS2c-2 replaces the flat shape with a sealed trait ADT:

```scala
sealed trait DataSource {
  def id: DataSourceId
  def name: String
  def ownerId: UserId
  def createdAt: Instant
  def updatedAt: Instant
  def kind: String        // "csv" | "rest_api" | "sql" | "static"
}
final case class CsvSource(id, name, ownerId, createdAt, updatedAt,    config: CsvSourceConfig)    extends DataSource
final case class RestSource(id, name, ownerId, createdAt, updatedAt,   config: RestApiConfig)      extends DataSource
final case class SqlSource(id, name, ownerId, createdAt, updatedAt,    config: SqlSourceConfig)    extends DataSource
final case class StaticSource(id, name, ownerId, createdAt, updatedAt) extends DataSource
```

Polymorphic config is now type-safe. Services receive a typed subtype and dispatch on subtype rather than parsing JSON. The `SourceType` enum becomes redundant — only `kind` survives as a thin discriminator string for the protocol/DB-row boundaries.

**The JSON wire shape evolves alongside.** Today:

```json
{ "id": "...", "name": "...", "sourceType": "csv", "config": { ...csv-specific fields... }, ...timestamps... }
```

After CS2c-2:

```json
{ "type": "csv", "id": "...", "name": "...", "config": { ...csv-specific fields... }, ...timestamps... }
```

The renamed `sourceType` → `type` discriminator brings the wire shape in line with the discriminated-union pattern the rest of CS2c uses (Panel and PipelineStep in CS2c-3). `config` keeps the same per-type internal shape — only the outer wrapper changes.

**This is the first intentional wire-contract evolution in HEL-236.** It's the smallest of the three ADTs (4 subtypes, configs already typed), which makes it the right entry point for the cross-tier coordination pattern.

## What changes

### Backend domain

`domain/DataSource.scala` extracted from `model.scala`:

```scala
sealed trait DataSource { /* common fields + kind */ }
final case class CsvSource(...)    extends DataSource { val kind = "csv" }
final case class RestSource(...)   extends DataSource { val kind = "rest_api" }
final case class SqlSource(...)    extends DataSource { val kind = "sql" }
final case class StaticSource(...) extends DataSource { val kind = "static" }
```

`SourceType` sealed trait + `asString` / `fromString` are removed if no longer referenced (the executor decides — if grep shows external uses, keep `SourceType.fromString` as a thin alias around `kind`-string parsing). The current `CsvSourceConfig` shape (currently a `JsObject` with implicit keys) becomes a real case class if it isn't already typed; otherwise reuse the existing one.

### Backend infrastructure

`infrastructure/DataSourceRepository.rowToDomain` switches from:

```scala
DataSource(id, name, SourceType.fromString(row.sourceType).right.get, row.config.parseJson, createdAt, updatedAt, ownerId)
```

to:

```scala
row.sourceType match {
  case "csv"      => CsvSource(id, name, ownerId, createdAt, updatedAt, row.config.parseJson.convertTo[CsvSourceConfig])
  case "rest_api" => RestSource(id, name, ownerId, createdAt, updatedAt, row.config.parseJson.convertTo[RestApiConfig])
  case "sql"      => SqlSource(id, name, ownerId, createdAt, updatedAt, row.config.parseJson.convertTo[SqlSourceConfig])
  case "static"   => StaticSource(id, name, ownerId, createdAt, updatedAt)
  case other      => throw new IllegalStateException(s"Unknown data source type in DB: $other")
}
```

`domainToRow` does the inverse: pattern-match on subtype, emit `(kind, configJson)`.

**DB table shape is unchanged.** `data_sources.source_type` text column continues to hold `"csv" / "rest_api" / "sql" / "static"`. `data_sources.config` continues to hold the JSON blob. No Flyway migration.

### Backend protocol

`api/protocols/DataSourceProtocol.scala` becomes a discriminated-union `RootJsonFormat[DataSource]`:

```scala
implicit object DataSourceFormat extends RootJsonFormat[DataSource] {
  def write(d: DataSource): JsValue = d match {
    case c: CsvSource    => JsObject("type" -> JsString("csv"),      "id" -> ..., "config" -> c.config.toJson, ...)
    case r: RestSource   => JsObject("type" -> JsString("rest_api"), "id" -> ..., "config" -> r.config.toJson, ...)
    case s: SqlSource    => JsObject("type" -> JsString("sql"),      "id" -> ..., "config" -> s.config.toJson, ...)
    case s: StaticSource => JsObject("type" -> JsString("static"),   "id" -> ..., ...)
  }
  def read(json: JsValue): DataSource = json.asJsObject.fields("type") match {
    case JsString("csv")      => CsvSource(...)
    case JsString("rest_api") => RestSource(...)
    case JsString("sql")      => SqlSource(...)
    case JsString("static")   => StaticSource(...)
    case other                => deserializationError(s"Unknown DataSource type: $other")
  }
}
```

Request bodies for `POST /api/data-sources` become discriminated unions on `type`. Response bodies emit the same shape. The change is symmetric.

### Backend services + routes

`services/DataSourceService.scala` and `services/SourceService.scala`:
- Methods receive typed `DataSource` and pattern-match on subtype only at the dispatch boundary (preview, refresh, infer, schema)
- `config.convertTo[X]` calls disappear from service code — typed in the constructor

Routes (`DataSourceRoutes`, `DataSourcePreviewRoutes`, `SourceRoutes`, `SourcePreviewRoutes`):
- Request entity unmarshalling uses the new discriminated-union JsonFormat
- Each route file stays ≤ 150 lines (already true today; the changes are mechanical)

### Frontend

`frontend/src/types/models.ts`:

```ts
export type DataSource =
  | { type: 'csv';      id: string; name: string; ownerId: string; createdAt: string; updatedAt: string; config: CsvConfig }
  | { type: 'rest_api'; id: string; ... ; config: RestConfig }
  | { type: 'sql';      id: string; ... ; config: SqlConfig }
  | { type: 'static';   id: string; ... };
```

`frontend/src/slices/dataSourcesSlice.ts` updates the create/update/list/get thunks for the new shape.

Source editor components narrow per subtype:

```tsx
if (source.type === 'csv') { /* CSV editor */ }
else if (source.type === 'rest_api') { /* REST editor */ }
// ...
```

The preview, refresh, and infer flows update to the typed payloads. The source list / detail views work off the discriminated union.

### Things that DO NOT change in CS2c-2

- **Panel ADT** — CS2c-3
- **PipelineStep ADT, engine split, run-lifecycle decomp** — CS2c-3
- **AuthService.scala** — security-sensitive; untouched
- **`domain/ExpressionEvaluator.scala`** — untouched
- **DB schema** — no Flyway migration
- **Existing endpoints** — same paths, same methods, evolved payloads only

## Impact

- **Specs affected**: OpenSpec spec.md files that reference DataSource (csv-upload-connector, datasource-edit-delete, frontend-data-sources-page, sql-database-connector, etc.) updated where their request/response payloads change. No JSON Schema files exist for DataSource today (verified) — the schemas/ directory has no `data-source.schema.json`. We will NOT create one in CS2c-2 unless drift surfaces.
- **Added**: `domain/DataSource.scala`. New `CsvSourceConfig` case class if the current shape isn't already typed.
- **Modified**: `domain/model.scala` (DataSource case class removed; SourceType pruned), `infrastructure/DataSourceRepository.scala` (typed rowToDomain), `api/protocols/DataSourceProtocol.scala` (discriminated union), `services/DataSourceService.scala`, `services/SourceService.scala`, 4 routes (`DataSourceRoutes`, `DataSourcePreviewRoutes`, `SourceRoutes`, `SourcePreviewRoutes`).
- **Frontend modified**: `types/models.ts`, `slices/dataSourcesSlice.ts`, source editor components, source list + detail views, preview/refresh/infer call sites.
- **Tests**: every existing test updated for the new wire shape. New ADT-specific tests for polymorphic dispatch + repo round-trip per subtype.
- **DB**: no migration.

## Out of scope

- Panel ADT, PipelineStep ADT (CS2c-3)
- Engine split, PipelineRunService, PipelineRunRoutes decomp (CS2c-3)
- Inner-vs-left-join codification (CS2c-3, in JoinStep.scala)
- HEL-242 / HEL-256 / HEL-265 (separate)
- New endpoints, new connectors, new fields beyond what ADT discrimination requires
- `PipelineService.AllowedOps` missing `"aggregate"` — spinoff for HEL-141 or its own ticket; do not pull in
- Per-subtype DB tables

## Acceptance criteria

- [ ] `DataSource` is a sealed trait with 4 strict per-subtype case classes
- [ ] `SourceType` is removed or reduced to a thin `kind`-string boundary (no `SourceType.X` pattern matches remain in route / service / engine code)
- [ ] Wire shape is a discriminated union: every JSON-emitting code path produces `{ "type": "...", ...config... }` and accepts the same
- [ ] Frontend `DataSource` type is a discriminated union; all consumers compile and lint clean
- [ ] `DataSourceRepository.rowToDomain` dispatches on `source_type` column; `domainToRow` flattens back. DB table shape unchanged.
- [ ] `services/DataSourceService.scala` and `services/SourceService.scala` consume typed ADT — no `config.convertTo[X]` at service-layer boundaries
- [ ] All 4 source routes consume the typed request/response shapes; each ≤ 150 lines
- [ ] `sbt test` + frontend `npm test` + lint + format + check:schemas + check:openspec + check:scala-quality all green
- [ ] AuthService byte-identical to main (`git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` empty)
- [ ] Manual Playwright smoke: create one source per subtype (CSV upload, REST API, Static; SQL if connector is wired in the dev env); refresh / preview each; bind a panel to a CSV-backed datatype and verify it renders
- [ ] No FQN violations
- [ ] File-size budgets respected (routes ≤ 150, services ≤ 300, other src ≤ 250)

## Risk

- **First wire-contract evolution.** Backend AND frontend must update in lockstep. Mitigation: per-tier task list + explicit Playwright smoke + evaluator Phase 3.
- **`SourceType` removal blast radius.** Grep before deleting — the enum may be referenced in tests, fixtures, or migration scripts. If pruning is risky, keep `SourceType` as a thin `kind`-string alias.
- **`CsvSourceConfig` shape.** REST and SQL configs are already typed; CSV may be a `JsObject` blob today. Adding a typed `CsvSourceConfig` case class is part of the work, not a side quest.
- **Preview/refresh/infer flows.** Connector logic touches the wire shape twice (request from client, response to client). Both sides of each flow must agree on the new shape.
- **HEL-256 may surface.** If StaticSource schema disappearance traces to ADT-related JSON marshalling, address inline OR spin a parallel side-PR — do not block CS2c-2.
- **Frontend type narrowing churn.** TypeScript will flag every site that accessed `source.config.*` without narrowing. Mitigation: a `isCsvSource(s: DataSource): s is CsvSource` style guard helper if 3+ consumers want the same narrow.
