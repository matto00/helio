# Design — backend-datasource-adt (CS2c-2)

> This change inherits the CS2c-series architectural design from `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` (preserved on main). That doc covers the full pattern (Panel + DataSource + PipelineStep). CS2c-2 implements only the DataSource portion plus the wire-shape transition machinery that CS2c-3 will reuse. Anything below restates DataSource-specific details for this PR.

## Package layout

### Backend

```
backend/src/main/scala/com/helio/domain/
├── model.scala                    (shrunk — DataSource flat case class removed; SourceType pruned)
└── DataSource.scala               (NEW — sealed trait + 4 subtypes; CsvSourceConfig if not typed)

backend/src/main/scala/com/helio/infrastructure/
└── DataSourceRepository.scala     (typed rowToDomain / domainToRow)

backend/src/main/scala/com/helio/api/protocols/
└── DataSourceProtocol.scala       (discriminated-union JsonFormat)

backend/src/main/scala/com/helio/services/
├── DataSourceService.scala        (typed ADT consumption; no JsValue.convertTo calls)
└── SourceService.scala            (same)

backend/src/main/scala/com/helio/api/routes/
├── DataSourceRoutes.scala         (typed entity unmarshalling)
├── DataSourcePreviewRoutes.scala  (same)
├── SourceRoutes.scala             (same)
└── SourcePreviewRoutes.scala      (same)
```

### Frontend

```
frontend/src/types/models.ts                 (DataSource → discriminated union)
frontend/src/slices/dataSourcesSlice.ts      (typed thunks)
frontend/src/components/sources/             (editors narrow per subtype)
```

No new directories. CS3 handles the feature-folder restructure.

## Wire shape transition — DataSource

### Discriminator + subtype field tables

The discriminator is the `type` field at the top level. The current `sourceType` field name is renamed to `type` to align with the CS2c-3 Panel + PipelineStep wire shapes. Subtype-specific data lives in `config`.

| Subtype | `type` value | `config` shape | Notes |
|---|---|---|---|
| CsvSource    | `"csv"`      | `{ filename, columns, encoding?, delimiter?, hasHeader? }` (TBD by existing CSV connector — preserve exact today's shape) | Wraps current CSV config JSON shape verbatim |
| RestSource   | `"rest_api"` | `RestApiConfig` (url, method, auth, headers) | Already typed |
| SqlSource    | `"sql"`      | `SqlSourceConfig` (dialect, host, port, database, user, password, query) | Already typed |
| StaticSource | `"static"`   | none / `{}` | StaticSource carries no config field — UI generates rows |

### Top-level common fields

```json
{
  "type": "<discriminator>",
  "id": "ds-1",
  "name": "Q1 sales",
  "ownerId": "user-1",
  "createdAt": "2026-05-14T10:00:00Z",
  "updatedAt": "2026-05-14T10:00:00Z",
  "config": { ...subtype-specific... }   // omitted for StaticSource
}
```

### Request shapes

**POST /api/data-sources** — request body:
```json
{ "type": "csv", "name": "Q1 sales", "config": { ...csv-specific... } }
```

**PATCH semantics**: today there is no `PATCH /api/data-sources/:id` (only GET / POST / DELETE / GET sources). CS2c-2 does NOT introduce one. If the executor finds an existing PATCH path during exploration, preserve its semantics and convert it to typed-by-subtype.

### Output shapes

`GET /api/data-sources` → array of discriminated-union objects. `GET /api/data-sources/:id` → single discriminated-union object. Same for `/api/data-sources/:id/sources`.

## Polymorphic method strategy

```scala
sealed trait DataSource {
  def id: DataSourceId
  def name: String
  def ownerId: UserId
  def createdAt: Instant
  def updatedAt: Instant
  def kind: String        // constant per subtype
}
```

Each subtype's `kind` is `final val` (`"csv"` / `"rest_api"` / `"sql"` / `"static"`). The `SourceType.asString(d.sourceType)` boilerplate disappears; protocol code reads `d.kind` directly.

`DataSourceService` and `SourceService` switch from `match { case SourceType.Csv => ... }` to:

```scala
def preview(source: DataSource, ...): Future[PreviewResult] = source match {
  case c: CsvSource    => csvConnector.preview(c.config, ...)
  case r: RestSource   => restConnector.preview(r.config, ...)
  case s: SqlSource    => sqlConnector.preview(s.config, ...)
  case s: StaticSource => Future.successful(staticPreview(s, ...))
}
```

The match becomes typed dispatch — exhaustiveness checking is enforced by the compiler.

## DB row → typed ADT mapping

### `DataSourceRepository.rowToDomain`

```scala
private def rowToDomain(row: DataSourceRow): DataSource = row.sourceType match {
  case "csv"      => CsvSource(DataSourceId(row.id), row.name, UserId(row.ownerId), row.createdAt, row.updatedAt,
                                row.configJson.parseJson.convertTo[CsvSourceConfig])
  case "rest_api" => RestSource(DataSourceId(row.id), row.name, UserId(row.ownerId), row.createdAt, row.updatedAt,
                                 row.configJson.parseJson.convertTo[RestApiConfig])
  case "sql"      => SqlSource(DataSourceId(row.id), row.name, UserId(row.ownerId), row.createdAt, row.updatedAt,
                                row.configJson.parseJson.convertTo[SqlSourceConfig])
  case "static"   => StaticSource(DataSourceId(row.id), row.name, UserId(row.ownerId), row.createdAt, row.updatedAt)
  case other      => throw new IllegalStateException(s"Unknown data source type in DB: $other")
}
```

### `domainToRow`

```scala
private def domainToRow(d: DataSource): DataSourceRow = d match {
  case c: CsvSource    => DataSourceRow(c.id.value, c.name, "csv",      c.config.toJson.compactPrint, c.ownerId.value, ...)
  case r: RestSource   => DataSourceRow(r.id.value, r.name, "rest_api", r.config.toJson.compactPrint, r.ownerId.value, ...)
  case s: SqlSource    => DataSourceRow(s.id.value, s.name, "sql",      s.config.toJson.compactPrint, s.ownerId.value, ...)
  case s: StaticSource => DataSourceRow(s.id.value, s.name, "static",   "{}",                          s.ownerId.value, ...)
}
```

StaticSource emits `"{}"` for the config column to satisfy the NOT NULL constraint (if any). Verify in the DB schema during execution.

### Legacy data tolerance

Existing rows in `data_sources` may have `source_type` values that don't match the new ADT — they should already match the current enum (`csv` / `rest_api` / `sql` / `static`) because the read path goes through `SourceType.fromString`. The `case other =>` fall-through provides a loud-failure escape hatch.

## Wire shape transition: the `sourceType` → `type` rename

The current API emits `sourceType`. CS2c-2 emits `type`. The frontend updates in the same PR.

**Why rename?** CS2c-3's Panel and PipelineStep wire shapes will use `type` as the discriminator (matches industry-standard JSON discriminator conventions and is shorter). Renaming DataSource in CS2c-2 aligns all three ADTs on the same discriminator key — important for downstream code-generation and for the agentic-platform vision (see [[project-helio-vision]]) where uniform shape simplifies tool definitions.

**Are there any external API consumers?** The frontend is the only consumer today. The agentic API exposure is post-CS2c. So the rename is safe.

If the executor finds a non-frontend consumer (e.g., a CLI script, a fixture script), report as a blocker — do not silently break.

## Frontend coordination plan

### Type definitions (`types/models.ts`)

```ts
export type CsvConfig = { filename: string; columns?: string[]; /* exact shape from current code */ };
export type RestConfig = { url: string; method: 'GET' | 'POST' | ...; auth: ...; headers: Record<string, string> };
export type SqlConfig = { dialect: string; host: string; port: number; database: string; user: string; password: string; query: string };

type DataSourceBase = { id: string; name: string; ownerId: string; createdAt: string; updatedAt: string };
export type CsvSource    = DataSourceBase & { type: 'csv';      config: CsvConfig };
export type RestSource   = DataSourceBase & { type: 'rest_api'; config: RestConfig };
export type SqlSource    = DataSourceBase & { type: 'sql';      config: SqlConfig };
export type StaticSource = DataSourceBase & { type: 'static' };
export type DataSource = CsvSource | RestSource | SqlSource | StaticSource;
```

If existing frontend code uses a `DataSourceType` enum or string literal type, replace with the discriminated union.

### Type narrowing helpers

Optional helper if 3+ sites want the same narrow:
```ts
export const isCsvSource = (s: DataSource): s is CsvSource => s.type === 'csv';
export const isRestSource = (s: DataSource): s is RestSource => s.type === 'rest_api';
// ...
```

Don't introduce a `DataSourceUnion<T>` indirection. Keep narrowing direct.

### Source editor components

Each source-type editor (CSV uploader, REST editor, Static editor, SQL editor) consumes its typed subtype. The source list view + detail view consume the union and narrow.

### Preview / refresh / infer flows

`POST /api/data-sources/:id/preview` and `:id/refresh` and `:id/infer` (or whatever the actual endpoints are — executor verifies) carry the source object in the response. Update the response handlers to expect the new shape.

## SourceType cleanup

The `SourceType` sealed trait currently has:

```scala
sealed trait SourceType
object SourceType {
  case object RestApi extends SourceType
  case object Csv     extends SourceType
  case object Static  extends SourceType
  case object Sql     extends SourceType
  def fromString(s: String): Either[String, SourceType] = ...
  def asString(t: SourceType): String = ...
}
```

After CS2c-2:

- If no remaining references → **delete the trait**
- If references remain (e.g., test fixtures, migration scripts) → **keep only `asString` / `fromString` as standalone helpers** named `DataSourceKind.kindString(...) / parseKind(...)` and delete the enum. The string is what the DB stores; the enum was an unnecessary intermediary.

The executor decides which path based on the grep result.

## Test strategy

### Backend

- **Every existing test passes** with the new wire shape. Update assertion payloads (`"sourceType": "csv"` → `"type": "csv"`; carry-over of common fields stays).
- **New ADT-specific tests** in `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala`:
  - Pattern-match coverage of all 4 subtypes
  - `kind` correctness per subtype
- **Repo round-trip** in `DataSourceRepositorySpec.scala`: insert → read → assert correct subtype, correct config.
- **Protocol round-trip** for each subtype (write → read → equality).

### Frontend

- Jest tests for `dataSourcesSlice.ts` updated for the new shape
- Snapshot tests for source editors regenerate
- Type-narrowing unit tests if `isCsvSource` etc. helpers exist

### Manual Playwright smoke (CS2c-2 minimum)

Evaluator's Phase 3 runs against `DEV_PORT=5174` / `BACKEND_PORT=8081`:

1. Login (`matt@helio.dev` / `heliodev123`)
2. Navigate to Data Sources page
3. Create one CSV source (upload a small CSV)
4. Create one REST source (point at a public mock API or skip if env doesn't allow)
5. Create one Static source
6. Create one SQL source (if SQL connector is wired in dev — skip otherwise; note in report)
7. Open each → preview → confirm rows render
8. Bind a panel on an existing dashboard to a DataType backed by the CSV source → confirm it renders the data
9. Delete one source → confirm cascading behavior intact

Any failure = BLOCKER.

## Coordination with HEL-256 (parallel)

If during exploration the executor finds that **StaticSource schema disappearance after restart** (HEL-256) traces to JSON marshalling of the `config` field (it likely does — Static has no typed config; today it stores `{}` or null and the schema is lost), the **fix lands in CS2c-2 as part of the typed `StaticSource` definition** (which now carries its schema as a typed field, or via the dedicated DataType row that should be linked to the source).

If the fix requires more than ~50 lines and a parallel side-PR off main, **flag as a blocker** and the orchestrator will spin HEL-256 separately. Do not silently fold a heavy fix into CS2c-2.

## File-size targets

| File | Today | Target |
|---|---:|---:|
| `domain/model.scala`              | 333 | ≤ 280 (DataSource extracted) |
| `domain/DataSource.scala`         | new | ≤ 150 |
| `infrastructure/DataSourceRepository.scala` | 97 | ≤ 200 (typed dispatch adds lines, still tiny) |
| `api/protocols/DataSourceProtocol.scala` | 166 | ≤ 220 (discriminator formatter adds lines, bounded) |
| `services/DataSourceService.scala` | 332 | ≤ 300 (drop `config.convertTo` calls) |
| `services/SourceService.scala`     | 340 | ≤ 300 (same) |
| All 4 source routes                | < 110 each | unchanged or smaller |

## Rollback plan

If a critical bug surfaces after merge:
1. Revert the merge commit — touches backend and frontend in one PR, so revert is clean
2. DB shape unchanged → no migration to roll back
3. Investigate, fix, re-land

## Open questions to resolve during execution

1. **`CsvSourceConfig` shape** — Is there a typed case class today, or is it a `JsObject` blob? If the latter, define a typed `CsvSourceConfig` matching what the CSV connector emits/consumes.
2. **`StaticSource` schema persistence** — Is the schema stored in the `data_sources.config` column, or on a linked `DataType` row? If the former, the new typed `StaticSource` needs a `schema: Seq[DataField]` field; this also likely addresses HEL-256.
3. **`/api/data-sources/:id/sources` shape** — What is the response shape today? Does it return DataSource shapes (in which case it inherits the new wire format) or something else?
4. **Frontend `DataSourceType` enum** — Does the frontend export an enum or string literal type today? If so, replace with the discriminated union.

The executor resolves these via code inspection during the work; capture decisions in the executor report.
