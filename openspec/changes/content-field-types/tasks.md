## 1. ### Backend: DataFieldType vocabulary

- [x] 1.1 Add `FieldTypeCategory` sealed trait (`Structured` | `Content`) to `domain/model.scala`
- [x] 1.2 Add `StringBodyType` and `BinaryRefType` case objects to `DataFieldType`
- [x] 1.3 Extend `DataFieldType.asString` for the two new variants (`"string-body"`, `"binary-ref"`)
- [x] 1.4 Add `DataFieldType.fromString(s: String): Option[DataFieldType]` (all 7 variants)
- [x] 1.5 Add `DataFieldType.category(t: DataFieldType): FieldTypeCategory`

## 2. ### Backend: binary_refs persistence

- [x] 2.1 Add `BinaryRef` case class (`id`, `dataTypeId`, `rowIndex`, `fieldName`, `storageKey`,
      `mimeType`, `filename`, `sizeBytes`, `createdAt`) to `domain/model.scala`
- [x] 2.2 Add Flyway migration `V46__binary_refs.sql` creating the `binary_refs` table + index on
      `data_type_id` + unique index on `(data_type_id, row_index, field_name)` (see design.md
      Decision 4 for exact column list)
- [x] 2.3 Add `BinaryRefRepository` (Slick) with `overwriteForDataType` (transactional
      delete-all-then-bulk-insert, mirroring `DataTypeRowRepository.overwriteRows`),
      `findByDataTypeId`, `findByDataTypeIdAndRow` — no singular `insert`/`delete(id)`, see
      design.md Decision 4

## 3. ### Frontend: Type Registry field editor

- [x] 3.1 Add `string-body` and `binary-ref` options to the `Select` in `TypeDetailPanel.tsx`
      (do not touch `InferredFieldsTable.tsx` — see design.md Decision 5)

## 4. ### Tests

- [x] 4.1 Unit test: `DataFieldType.asString`/`fromString` round-trip for all 7 variants
- [x] 4.2 Unit test: `fromString("unknown-type")` returns `None`
- [x] 4.3 Unit test: `DataFieldType.category` classifies all 7 variants correctly
- [x] 4.4 Backend test: Flyway migration applies cleanly against a fresh test database
- [x] 4.5 Backend test: `BinaryRefRepository` `overwriteForDataType`/`findByDataTypeId`/
      `findByDataTypeIdAndRow` round-trip, including that a second `overwriteForDataType` call
      replaces (not appends to) the prior snapshot for that `dataTypeId`
- [x] 4.6 Frontend test: `TypeDetailPanel` renders `string-body`/`binary-ref` as selectable options
