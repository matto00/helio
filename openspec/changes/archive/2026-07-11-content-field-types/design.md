## Context

`DataFieldType` (`backend/src/main/scala/com/helio/domain/model.scala:209`) is a closed sealed
trait with 5 structured variants (`StringType`/`IntegerType`/`FloatType`/`BooleanType`/
`TimestampType`), mapped to wire strings via `DataFieldType.asString`. It is the vocabulary
`SchemaInferenceEngine` uses when inferring a `DataType`'s fields from a connector (CSV/JSON/SQL).
The persisted `DataField.dataType` and `ComputedField.dataType` are plain `String` — there is no
server-side allow-list anywhere (`RequestValidation.scala` has zero `dataType` checks), and
`data_types.fields` (TEXT/JSON blob) and `data_type_rows.data` (JSONB) already store arbitrary
shapes without a DB-level enum constraint. Frontend field-type editors (`TypeDetailPanel.tsx`,
`InferredFieldsTable.tsx`) hardcode the same 5-option `Select` list.

There is no existing per-row binary storage registry: the only current binary-adjacent
convention is `DataSource`'s CSV `path`, a single relative key into the uploads `FileSystem`
abstraction (local disk or GCS, per `HELIO_UPLOADS_BACKEND`) set once at source registration.
v1.4 connectors (PDF/image) will ingest many binaries, one potentially per row.

## Goals / Non-Goals

**Goals:**
- Extend `DataFieldType` with `StringBodyType`/`BinaryRefType`, distinct from structured types.
- Give downstream connectors/pipeline ops one canonical, typed value shape per content type.
- Add durable, queryable storage for binary metadata (not just an opaque JSON blob convention).
- Keep everything additive/backward-compatible — no change to existing 5 types' behavior.

**Non-Goals:**
- Implementing the PDF/text/image connectors or text pipeline ops themselves.
- Casting/compute support between content and structured types (`CastStep`, `ExpressionEvaluator`
  are untouched — ops that operate on content fields are downstream tickets' concern).
- A garbage-collection job for orphaned binaries when rows/types are deleted (follow-up).
- General `dataType` string validation/allow-listing — none exists today; not this ticket's job.

## Decisions

1. **`FieldTypeCategory` as a classifier over `DataFieldType`, not a parallel hierarchy.**
   Add `sealed trait FieldTypeCategory { case object Structured; case object Content }` and
   `DataFieldType.category(t): FieldTypeCategory`. Alternative considered: split into two
   unrelated sealed traits — rejected because `InferredField.dataType`, `SchemaInferenceEngine`,
   and the wire string conversion all key off a single `DataFieldType`; splitting would force a
   union type everywhere that reads it today.

2. **Two new `DataFieldType` case objects, wire strings `string-body` / `binary-ref`.**
   Add `DataFieldType.fromString(s): Option[DataFieldType]` (the reverse of `asString`, which
   doesn't exist yet) so callers that need to parse a persisted/wire dataType string back into
   the ADT (e.g. future pipeline ops checking "is this field content-typed") have one canonical
   parser rather than re-deriving the mapping. The existing `openspec/specs/schema-inference/`
   capability's "DataFieldType sealed type" requirement hardcodes "exactly five variants" —
   this change makes that requirement false, so it needs a `MODIFIED Requirements` delta (see
   `specs/schema-inference/spec.md` in this change) updating the variant count/`asString`
   scenario to all 7. `SchemaInferenceEngine.widenType`'s exhaustive match over the 5 structured
   variants (model.scala/SchemaInferenceEngine.scala:133-159) becomes non-exhaustive as a result;
   this is a compiler-warning-only, functionally inert change (`widenType`'s `current` is never
   seeded with a content type — inference never produces one), so no source change is required
   there in this ticket, only awareness for the executor.

3. **Value shape: `string-body` = plain JSON string; `binary-ref` = `{storageKey, mimeType,
   filename, sizeBytes}` object.** Both fit inside the existing `data_type_rows.data JSONB`
   column with no row-storage changes (Postgres TOAST already handles large string values
   transparently; `PanelRowMapper`/`DataTypeRowRepository` are already fully generic over row
   shape). `storageKey` reuses the existing uploads `FileSystem` convention (same relative-key
   idea as `DataSource`'s CSV `path`) rather than inventing new binary transport. **This inline
   JSONB value is the sole read path for row data** — any consumer reading a row via
   `DataTypeRowRepository`/`data_type_rows` gets the full binary metadata with no join.

4. **New `binary_refs` table is a row-correlated secondary index, not a second read path.**
   `binary_refs` exists solely for lookups that don't require deserializing every row's JSONB
   (lifecycle management: "what binaries exist for this type/row," future GC, asset browsing) —
   it is a derived index over the same data written to `data_type_rows.data`, never an
   independent source of truth pipeline ops read from instead of the row. To make that lookup
   answerable at the granularity connectors actually need (design's Context: "one binary
   potentially per row"), the table carries a `row_index INT NOT NULL` column mirroring
   `data_type_rows.row_index`, with a unique index on `(data_type_id, row_index, field_name)`.
   Columns: `id` (TEXT PK), `data_type_id` (TEXT, indexed, no FK — mirrors
   `data_type_rows.data_type_id`, which also has no FK to `data_types`), `row_index` (INT),
   `field_name` (TEXT), `storage_key` (TEXT), `mime_type` (TEXT), `filename` (TEXT),
   `size_bytes` (BIGINT), `created_at` (TIMESTAMPTZ).

   **Write contract**: `BinaryRefRepository` exposes `overwriteForDataType(dataTypeId, refs)`
   — a transactional delete-all-then-bulk-insert for that `dataTypeId`, mirroring
   `DataTypeRowRepository.overwriteRows`'s exact semantics — plus read-only
   `findByDataTypeId`/`findByDataTypeIdAndRow`. A connector/pipeline run that calls
   `overwriteRows` to replace a `DataType`'s row snapshot SHALL call
   `overwriteForDataType` with the same run's binary refs in the same operation, so the index
   never drifts from the row snapshot it describes and re-runs don't accumulate orphaned rows.
   (No singular `insert`/`delete(id)` — the delete-and-replace model is the only writer.)

   Alternative considered: encode metadata only inline in the JSONB row value, no new table —
   rejected because it gives connectors/ops no queryable, row-scoped, deletion-independent
   record of "what binaries exist for this type," which the ticket's "clean and extensible for
   downstream consumers" goal calls for. No REST route is added in this ticket — HEL-214/HEL-216
   connectors will call both `overwriteRows` and `overwriteForDataType` directly when writing
   ingested rows, exactly as pipeline runs call `overwriteRows` today (not exposed as a public
   write endpoint).

5. **Frontend: add the two new options only to `TypeDetailPanel.tsx`'s field-type `Select`**
   (the Type Registry's own field editor), not `InferredFieldsTable.tsx` (source-schema-inference
   preview). No current connector infers content types yet, so offering them at
   inference-preview time would be misleading; a Type Registry field can still be manually
   retyped to `string-body`/`binary-ref` once populated by a downstream connector.

## Risks / Trade-offs

- [No FK from `binary_refs.data_type_id` → `data_types.id`] → Matches the existing
  `data_type_rows` precedent in this codebase; orphan cleanup is explicitly deferred
  (non-goal), so a hard FK would only add cascade-delete complexity without a consumer yet.
- [`fromString` introduces a second source of truth alongside `asString`] → Both live in the
  `DataFieldType` companion object as inverses of each other; a unit test asserting
  round-trip (`fromString(asString(t)) == Some(t)`) for all 7 variants keeps them in sync.
- [Adding options to `TypeDetailPanel.tsx` without any producer of content-typed rows yet] →
  Acceptable: the Type Registry is the schema/contract surface: a field can be declared
  content-typed before any connector produces matching row data, same as any newly-created
  structured field starts with no rows.
- [`binary_refs` drifting from `data_type_rows` if a future caller writes one without the other]
  → Mitigated by making `overwriteForDataType` the only writer (no singular insert), always
  called alongside `overwriteRows` in the same run, and documenting `binary_refs` explicitly as
  a derived index (never an independent read path) so there is one clear authoritative source
  (the row JSONB) and one clear rebuild rule.
- [This ticket doesn't wire `overwriteForDataType` into any real call site, since no connector
  exists yet] → Acceptable: the repository/table contract is what downstream connector tickets
  need to land against; wiring happens when HEL-214/216 land, same as `binary_refs` itself being
  unused until then.

## Planner Notes

- Self-approved: adding a new `binary_refs` table (Decision 4) rather than only extending the
  `DataFieldType` vocabulary. This is additive persistence work matching the ticket's explicit
  "Backend schema update + Flyway migration" ask and its instruction to design the type model
  to be "clean and extensible" for the connector/pipeline-op tickets that follow. Not a breaking
  change, no new external dependency, contained to one new table + repository.
- Self-approved: no FK constraint on `binary_refs.data_type_id`, matching existing
  `data_type_rows` precedent rather than introducing a new referential-integrity pattern.
