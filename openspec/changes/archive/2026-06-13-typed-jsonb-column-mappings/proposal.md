## Why

The V33 JSONB migration left Scala row fields as `String`, requiring manual
`.parseJson` / `.toJson.compactPrint` at every repository read/write boundary.
Introducing typed `MappedColumnType` mappings moves that concern into the column
definition and makes row case classes carry the correct domain types directly.

## What Changes

- **`DashboardRepository`**: `DashboardRow.appearance` → `DashboardAppearance`;
  `DashboardRow.layout` → `DashboardLayout`. `jsonbStringType` replaced by two typed
  column types. `rowToDomain` / `domainToRow` / `update` drop the manual
  `.parseJson.convertTo[…]` / `.toJson.compactPrint` calls.
- **`PanelRowMapper` / `PanelRepository`**: `PanelRow.appearance` →
  `PanelAppearance`. `PanelRepository.batchUpdate` and `updateAppearance` drop
  manual serialize/deserialize. `fieldMapping` stays `Option[String]` (it holds
  an opaque `JsObject` that the domain passes through verbatim — no meaningful
  typed column mapping exists). Unify `O.SqlType("jsonb")` cosmetic inconsistency
  on `fieldMapping` column definition.
- **`DataTypeRepository`**: `DataTypeRow.fields` → `Vector[DataField]`;
  `DataTypeRow.computedFields` → `Vector[ComputedField]`. `rowToDomain` /
  `domainToRow` / `update` / `updateInternal` drop manual serialize/deserialize.
- **`DataSourceRepository`**: `data_sources.config` is **excluded** — the config
  column is a polymorphic blob dispatched by `source_type`. A typed
  `MappedColumnType` would couple the column to a single type; the existing
  `DataSourceConfigCodec` dispatch is already idiomatic and correct. No change.
- **Non-goals**: no schema migration (V33 already did the column work), no
  changes to wire/JSON shapes, no changes to `PanelProtocol` / `DashboardProtocol`
  formatters, no changes to `DataSourceRepository`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `backend-persistence`: repository row case classes now carry parsed domain
  types for JSONB columns; the repository boundaries no longer contain manual
  parse/print calls for these fields. Behavior is identical at the wire and DB
  level.

## Impact

- **Files modified**: `DashboardRepository.scala`, `PanelRepository.scala`,
  `PanelRowMapper.scala`, `DataTypeRepository.scala`
- **No API or schema changes** — pure internal refactor
- **No migration** — V33 is already in place
- **Tests**: all existing backend ScalaTest suites must continue to pass
