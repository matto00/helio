## Files modified

- `backend/src/main/scala/com/helio/domain/model.scala` — added `FieldTypeCategory` (`Structured`/`Content`), `DataFieldType.StringBodyType`/`BinaryRefType`, `DataFieldType.fromString` (reverse of `asString`), `DataFieldType.category`, and the `BinaryRef` domain model.
- `backend/src/main/resources/db/migration/V46__binary_refs.sql` — new `binary_refs` table (row-correlated secondary index for `binary-ref` field metadata), index on `data_type_id`, unique index on `(data_type_id, row_index, field_name)`, and RLS (`ENABLE`/`FORCE ROW LEVEL SECURITY` + indirect-owner policy via `data_type_id -> data_types.owner_id`), mirroring the existing `data_type_rows` (V29/V35) precedent per CONTRIBUTING.md's "new ACL'd table" rule.
- `backend/src/main/scala/com/helio/infrastructure/BinaryRefRepository.scala` — new repository with `overwriteForDataType` (transactional delete-all-then-bulk-insert, mirroring `DataTypeRowRepository.overwriteRows`), `findByDataTypeId`, `findByDataTypeIdAndRow`. No singular insert/delete.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added `binary_refs` to the `rlsTables` allowlist so the RLS structural guard covers the new table.
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx` — added `string-body`/`binary-ref` options to the field-type `Select` (Type Registry's own field editor only, per design.md Decision 5; `InferredFieldsTable.tsx` intentionally untouched).

## Test files added

- `backend/src/test/scala/com/helio/domain/DataFieldTypeSpec.scala` — unit tests: `asString`/`fromString` round-trip for all 7 variants, `fromString("unknown-type")` returns `None`, `category` classifies all 7 variants.
- `backend/src/test/scala/com/helio/infrastructure/BinaryRefsMigrationSpec.scala` — integration test: V46 migration creates `binary_refs` with the expected columns, the `data_type_id` index, and the composite unique index.
- `backend/src/test/scala/com/helio/infrastructure/BinaryRefRepositorySpec.scala` — round-trip test for `overwriteForDataType`/`findByDataTypeId`/`findByDataTypeIdAndRow`, including that a second `overwriteForDataType` call replaces (not appends to) the prior snapshot, and per-DataType isolation.
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.test.tsx` — renders `TypeDetailPanel` and asserts `string-body`/`binary-ref` appear as selectable options alongside the 5 structured types.

## Notes

- `SchemaInferenceEngine.widenType`'s match over the 5 structured variants (model.scala/SchemaInferenceEngine.scala:135-159) is now non-exhaustive (compiler-warning-only per design.md Decision 2 — `current` is never seeded with a content type, so this is functionally inert). No source change made there, per design's explicit instruction.
- `binary_refs` RLS was not explicitly called out in design.md, but CONTRIBUTING.md's "Adding a new ACL'd table" rule is unconditional and `binary_refs` is user-owned data indirectly correlated via `data_type_id`, exactly like the existing `data_type_rows` table. Added RLS + the `RlsPolicyGuardSpec` allowlist entry mirroring that precedent rather than treating it as a redesign.
