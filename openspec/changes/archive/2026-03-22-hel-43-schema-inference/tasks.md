## 1. Domain Types

- [x] 1.1 Add `DataFieldType` sealed trait (`StringType`, `IntegerType`, `FloatType`, `BooleanType`, `TimestampType`) with `asString` to `backend/src/main/scala/com/helio/domain/model.scala`
- [x] 1.2 Add `InferredField(name, displayName, dataType: DataFieldType, nullable)` and `InferredSchema(fields: Seq[InferredField])` case classes to `model.scala`

## 2. Schema Inference Engine

- [x] 2.1 Create `backend/src/main/scala/com/helio/domain/SchemaInferenceEngine.scala` with object `SchemaInferenceEngine`
- [x] 2.2 Implement `displayName(name: String): String` — converts `snake_case`, `camelCase`, and dot-paths to title-case words
- [x] 2.3 Implement `fromJson(json: JsValue): InferredSchema` — handles root `JsObject` and `JsArray`, flattens nested objects with dot notation, maps JSON types to `DataFieldType`, detects `TimestampType` from string values
- [x] 2.4 Implement private `inferJsonType(value: JsValue): (DataFieldType, Boolean)` helper returning `(type, isNullable)`
- [x] 2.5 Implement private `isTimestamp(s: String): Boolean` — tries `ISO_DATE_TIME`, `ISO_LOCAL_DATE`, and `MM/dd/yyyy` parsers
- [x] 2.6 Implement `fromCsv(csv: String): InferredSchema` — parses header row, samples up to 100 rows, widens types per column, marks nullable on empty cells
- [x] 2.7 Implement private `widenType(current: DataFieldType, value: String): DataFieldType` for CSV column widening

## 3. Tests

- [x] 3.1 Create `backend/src/test/scala/com/helio/domain/SchemaInferenceEngineSpec.scala`
- [x] 3.2 JSON tests: root object with mixed types, root array with union of keys, nested object flattening, null nullable, integer vs float, timestamp from ISO string
- [x] 3.3 CSV tests: header row, integer column, float widening, boolean detection, timestamp detection, string fallback, empty-cell nullable, 100-row cap
- [x] 3.4 displayName tests: snake_case, camelCase, dot-separated

## 4. Verification

- [x] 4.1 Run `sbt test` in `backend/` — all tests pass
