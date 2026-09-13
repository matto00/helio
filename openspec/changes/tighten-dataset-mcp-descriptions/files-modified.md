- `helio-mcp/src/tools/canonicalColumnTypes.ts` — new: single source-of-truth constant
  (`CANONICAL_COLUMN_TYPES`/`CANONICAL_COLUMN_TYPES_LIST`) for the 7 canonical column `type`
  strings, replicated locally (not imported) from the backend's `DataFieldType.CanonicalWireValues`.
- `helio-mcp/src/tools/canonicalColumnTypesDriftGuard.test.ts` — new: Jest drift-guard test
  mirroring `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts`, reading
  `backend/src/main/scala/com/helio/domain/model/model.scala` directly to assert the new constant
  matches `CanonicalWireValues` in content and order.
- `helio-mcp/src/tools/write.ts` — `create_data_source`: enumerates the 7 canonical types and
  documents the explicit-`default: null`-vs-omitted-`default` limitation at creation time;
  `append_dataset_rows`/`replace_dataset_rows`: rewrote descriptions to state the real short-row
  and explicit-`null`-position padding behavior instead of implying outright rejection;
  `update_dataset_schema`: enumerates the 7 canonical types, notes it (unlike `create_data_source`)
  preserves the explicit-null-default distinction.
- `helio-mcp/src/tools/read.ts` — `get_dataset_schema`: enumerates the 7 canonical types inline.
