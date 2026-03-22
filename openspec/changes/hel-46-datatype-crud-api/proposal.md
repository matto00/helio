## Why

The TypeRegistry (HEL-42) stores DataTypes in the database but exposes no REST surface, making them unreachable from the frontend or any connector. Panels also have no way to declare which DataType they display. This change wires the two together: a CRUD API for the TypeRegistry and a `typeId` / `fieldMapping` binding on panels.

## What Changes

- **New**: `GET /api/types` — list all registered DataTypes
- **New**: `GET /api/types/:id` — get a single DataType with full field detail
- **New**: `PATCH /api/types/:id` — update name and fields (increments version)
- **New**: `DELETE /api/types/:id` — remove a DataType; returns 409 if any panel is bound to it
- **New**: `GET /api/data-sources` — list all data sources
- **Modified**: `PATCH /api/panels/:id` — accepts new optional fields `typeId` (nullable string) and `fieldMapping` (nullable JSON object `{ slotName: fieldName }`)
- **New**: Flyway V5 migration — adds `type_id` (nullable FK → data_types) and `field_mapping` (nullable text/JSON) columns to `panels`
- **New**: JSON formats for DataSource, DataType, and DataField API responses
- **New**: Route tests for all new endpoints and the extended panel patch

## Capabilities

### New Capabilities

- `datatype-crud-api`: REST endpoints for listing, fetching, updating, and deleting DataTypes, plus a 409 guard for deletion when panels are bound
- `panel-datatype-binding`: Panels can be bound to a DataType via `typeId` and `fieldMapping` through the existing panel PATCH endpoint

### Modified Capabilities

- `data-type-persistence`: Extended — panels now reference data_types via FK; `DataTypeRepository` needs a `isBoundToAnyPanel` check
- `backend-persistence`: Panels table gains `type_id` and `field_mapping` columns; `PanelRepository` updated to persist and return them

## Impact

- New Flyway migration `V5__panel_type_binding.sql`
- `ApiRoutes.scala` — new type/data-source routes, extended panel PATCH
- `JsonProtocols.scala` — new request/response types for types and data sources
- `PanelRepository.scala` — new columns in row/table, updated domain model
- `DataTypeRepository.scala` — new `isBoundToAnyPanel` query
- `model.scala` — Panel gains `typeId: Option[DataTypeId]` and `fieldMapping: Option[JsValue]`
- `ApiRoutesSpec.scala` — new route tests
