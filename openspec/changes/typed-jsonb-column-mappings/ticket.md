# HEL-283 — Adopt typed MappedColumnType for JSON row fields (drop manual parseJson/compactPrint)

## Context

Follow-up from HEL-132 (TEXT→JSONB migration). That change moved the storage type to `JSONB` and added a `jsonbStringType: BaseColumnType[String]` mapping, but deliberately kept the Scala-side row fields as `String` (Design Decision 1 — avoid cascading domain-model changes within the migration).

As a result, the repository/service layers still manually serialize and deserialize JSON on every read/write via `.parseJson` and `.toJson.compactPrint`. The DB column is now `JSONB`, but the application code hasn't reaped the ergonomic benefit.

## Proposal

Introduce a typed `MappedColumnType` (Slick) per JSON-bearing field so the domain model carries the parsed type directly, and the column mapping handles (de)serialization transparently:

```scala
implicit val appearanceColumnType: BaseColumnType[Appearance] =
  MappedColumnType.base[Appearance, String](
    _.toJson.compactPrint,
    _.parseJson.convertTo[Appearance]
  )
```

Then remove the now-redundant manual `.parseJson` / `.compactPrint` calls at the repository boundaries.

## Affected fields (same set as HEL-132)

* `dashboards.appearance`, `dashboards.layout`
* `panels.appearance`, `panels.field_mapping`
* (plus the remaining JSONB columns migrated in V33 — confirm full list against `V33__jsonb_columns.sql`)

## Acceptance Criteria

* Domain models carry parsed types (not raw `String`) for the migrated JSON fields
* No manual `.parseJson` / `.toJson.compactPrint` at repository read/write boundaries for these fields
* Behavior-preserving: wire/JSON shapes unchanged, all existing tests pass
* Spray JSON formatters reused (no duplicate (de)serialization logic)

## Notes

* Pure refactor — no schema migration (V33 already did the column work)
* Watch for the `PanelRepository.fieldMapping` cosmetic inconsistency noted in HEL-132 review (`O.SqlType("jsonb")` vs the implicit) — unify while here

## Related

* HEL-132 — TEXT→JSONB migration (parent change)
