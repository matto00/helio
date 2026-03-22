## Why

Connectors (REST API, CSV upload) need to automatically derive a typed schema from raw data so users don't have to define fields by hand. A schema inference engine is the shared core that both connectors depend on before any data can be registered in the TypeRegistry.

## What Changes

- **New**: `SchemaInferenceEngine` object — pure stateless functions `fromJson` and `fromCsv`
- **New**: `DataFieldType` sealed trait (`StringType`, `IntegerType`, `FloatType`, `BooleanType`, `TimestampType`)
- **New**: `InferredField` and `InferredSchema` output types
- JSON inference: root array or object, type mapping, dot-notation flattening for nested objects, Timestamp detection from string values
- CSV inference: header row, sample up to 100 rows, widening type order (integer → float → boolean → timestamp → string), empty-cell nullable detection
- Unit tests covering all inference rules and edge cases

## Capabilities

### New Capabilities

- `schema-inference`: Pure-function engine that infers a typed schema from a JSON `JsValue` or CSV string and returns `InferredSchema`

### Modified Capabilities

*(none)*

## Impact

- New file: `backend/src/main/scala/com/helio/domain/SchemaInferenceEngine.scala`
- New test: `backend/src/test/scala/com/helio/domain/SchemaInferenceEngineSpec.scala`
- No changes to existing repositories, routes, or database schema
- `DataFieldType` and `InferredSchema` will be consumed by HEL-44 (REST connector) and HEL-45 (CSV connector)
