## Context

The TypeRegistry (HEL-42) stores `DataType` records whose `fields` are `Vector[DataField]`. Connectors (REST, CSV) need to produce those fields automatically from raw data. The inference engine is the shared core — a pure object with no I/O, no actor dependency, no database access.

Existing domain model already has `DataField(name, displayName, dataType: String, nullable)`. The engine introduces a proper `DataFieldType` sealed type alongside `InferredField` / `InferredSchema` as its output. Connectors map `InferredSchema → Vector[DataField]` when registering a `DataType`.

## Goals / Non-Goals

**Goals:**
- Infer typed fields from a Spray JSON `JsValue` (REST responses)
- Infer typed fields from a raw CSV string (upload payloads)
- Detect `Timestamp` from string values matching ISO-8601 or common date patterns
- Flatten nested JSON objects using dot notation
- Be deterministic and side-effect free

**Non-Goals:**
- Deeply nested arrays / arrays of arrays (treat as StringType)
- Schema merging across multiple fetches
- User-defined type overrides (handled downstream)
- Any I/O, DB access, or actor interaction

## Decisions

### 1. Location: `com.helio.domain`, not `infrastructure`

The engine has no I/O and depends only on the domain model and Spray JSON. Placing it in `domain` keeps it testable without any DB or actor setup, and reinforces the clean-architecture boundary.

### 2. `DataFieldType` sealed trait (not String)

`DataField.dataType` is a `String` for flexible storage. Internally the engine uses a sealed `DataFieldType` to make exhaustive matching safe. Connectors convert with `DataFieldType.asString`.

```scala
sealed trait DataFieldType
object DataFieldType {
  case object StringType    extends DataFieldType
  case object IntegerType   extends DataFieldType
  case object FloatType     extends DataFieldType
  case object BooleanType   extends DataFieldType
  case object TimestampType extends DataFieldType

  def asString(t: DataFieldType): String = ...
}
```

### 3. Timestamp detection via `java.time` parsers

Try `DateTimeFormatter.ISO_DATE_TIME`, `ISO_LOCAL_DATE`, and a few common formats (`yyyy-MM-dd`, `MM/dd/yyyy`, `dd-MMM-yyyy`). If any parse succeeds → `TimestampType`. Cheaper than a regex and reuses the JDK.

### 4. CSV type widening order: integer → float → boolean → timestamp → string

Each column starts as the narrowest possible type and widens if a value doesn't fit. `string` is the catch-all. This matches the ticket spec with Timestamp inserted before string.

### 5. JSON dot-notation flattening (depth-first, no array recursion)

Nested `JsObject` values are flattened into `parent.child` keys. `JsArray` values inside objects are typed as `StringType` (not recursed) — array-of-object support is out of scope for this ticket.

### 6. `displayName` auto-generated from field name

Convert `snake_case` / `camelCase` / dot-separated names to title-case words. E.g., `address.city` → `Address City`, `createdAt` → `Created At`. Connectors or users can override later.

## Risks / Trade-offs

- **Timestamp false positives** — short numeric strings (`2024`) could match some date formats. Mitigation: require full ISO-8601 (`YYYY-MM-DD` minimum) or unambiguous named-month formats.
- **Large CSV files** — sampling is capped at 100 rows to bound cost. Very long headers with unusual characters pass through as-is.
- **JSON type ambiguity** — a field that is `null` in all sampled rows stays `StringType` + nullable (safest default). Connectors can allow user override.
