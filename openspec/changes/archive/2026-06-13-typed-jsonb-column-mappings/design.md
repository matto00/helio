## Context

V33 migrated TEXT JSON columns to JSONB but kept Scala row fields as `String` with a
pass-through `jsonbStringType: BaseColumnType[String]` to avoid cascading model changes.
Every repository boundary still calls `.parseJson.convertTo[T]` on read and
`.toJson.compactPrint` on write. The Spray JSON formatters for each target type already
exist in `DashboardProtocol`, `PanelProtocol`, and `DataTypeProtocol`.

## Goals / Non-Goals

**Goals:**
- Row case class fields carry parsed domain types for all V33 JSONB columns where a
  single stable type exists (`DashboardAppearance`, `DashboardLayout`, `PanelAppearance`,
  `Vector[DataField]`, `Vector[ComputedField]`)
- Eliminate manual `.parseJson` / `.toJson.compactPrint` at repository read/write boundaries
  for those fields
- Unify `fieldMapping` column definition cosmetic inconsistency (`O.SqlType("jsonb")` vs
  `jsonbStringType` implicit)

**Non-Goals:**
- `data_sources.config`: the config blob is polymorphic (dispatched by `source_type`);
  a `MappedColumnType` would couple the column to one concrete type. `DataSourceConfigCodec`
  is the correct abstraction here — no change.
- `panels.field_mapping` domain type: the domain already carries `JsObject` semantically;
  the row holds `Option[String]`. The column stays `Option[String]` because `JsObject` is not
  directly usable as the Slick column type without a custom writer, and the existing
  `PanelRowMapper` helpers already encapsulate the String↔JsObject conversion.
- Schema migrations — V33 is complete.
- API or wire-shape changes.

## Decisions

**D1. One `MappedColumnType` per target Scala type, declared in each companion object.**

The existing `instantColumnType` in each repo companion is the exact pattern to follow:
`MappedColumnType.base[T, String](_.toJson.compactPrint, _.parseJson.convertTo[T])`.
Each companion already imports the relevant protocol implicitly via trait-mixing in the
repository class; the companion object gets a plain `import spray.json._` and a direct
`jsonFormat` call-site import to resolve the formatter. The `jsonbStringType` identity
mapping stays in each companion as an alias for non-typed JSONB columns (e.g.,
`DataSourceRepository`). In `DashboardRepository` and `PanelRepository` the new typed
column types supersede `jsonbStringType` for the affected columns; the identity mapping
can be removed if no longer needed.

**D2. `PanelAppearance` formatter is available via `PanelProtocol` mix-in in `PanelRowMapper`.**

`PanelRowMapper extends PanelProtocol` already, so `panelAppearanceFormat` is in implicit
scope. The `MappedColumnType` for `PanelAppearance` in `PanelRepository`'s companion object
must import the same format. Resolved by adding a direct import of `PanelProtocol` formatters
or by declaring the type in the companion with explicit format reference.

**D3. `DashboardLayout` / `DashboardAppearance` column types in `DashboardRepository`.**

`DashboardProtocol` already declares `dashboardAppearanceFormat` and `dashboardLayoutFormat`.
These are used in the `MappedColumnType` definitions in `DashboardRepository`'s companion.
The companion object gets the protocol-derived formats via a local import.

**D4. `Vector[DataField]` / `Vector[ComputedField]` column types in `DataTypeRepository`.**

`DataTypeProtocol` declares `dataFieldFormat` and `computedFieldFormat`. The companion
imports these to define the column types. `DataTypeRow.fields` changes from `String` to
`Vector[DataField]`; `DataTypeRow.computedFields` changes from `String` to
`Vector[ComputedField]`.

## Risks / Trade-offs

- [Implicit resolution] `MappedColumnType` expressions in companion objects run outside the
  trait mix-in scope — formatters must be imported explicitly. Mitigation: import the
  specific `RootJsonFormat` instances at the companion object level via direct import of the
  protocol object or local `implicit val`.
- [Test coverage] All existing repo-level integration tests (`DataTypeRepositorySpec`,
  `DataSourceRepositorySpec`, etc.) are the verification gate. No new tests are needed —
  behaviour is identical. Mitigation: run full `sbt test` before committing.

## Planner Notes

Self-approved — pure refactor, no external dependencies, no API surface change, no new
capabilities. The only risk is implicit-resolution subtlety in Slick companion objects,
which is well-understood and documented above.
