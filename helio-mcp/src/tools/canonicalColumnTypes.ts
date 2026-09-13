/**
 * HEL-1129 tasks.md 1.1: the ONE place `helio-mcp`'s dataset tool descriptions source the list of
 * valid column `type` strings from -- all 7 canonical types, in the same order as the backend's
 * `DataFieldType.CanonicalWireValues`
 * (`backend/src/main/scala/com/helio/domain/model/model.scala`). `helio-mcp` is a separate npm
 * package with no dependency on `frontend/`, so this mirrors (rather than imports)
 * `frontend/src/features/sources/types/dataSource.ts`'s `CANONICAL_FIELD_TYPES` --
 * `canonicalColumnTypesDriftGuard.test.ts` cross-checks this array against the backend source
 * directly rather than trusting a hand-copied twin.
 */
export const CANONICAL_COLUMN_TYPES = [
  "string",
  "integer",
  "float",
  "boolean",
  "timestamp",
  "string-body",
  "binary-ref",
] as const;

/** Human-readable inline list for interpolation into tool descriptions, e.g. "string, integer,
 *  float, boolean, timestamp, string-body, binary-ref". */
export const CANONICAL_COLUMN_TYPES_LIST = CANONICAL_COLUMN_TYPES.join(", ");
