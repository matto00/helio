# Files modified — HEL-372 sample-rows-datatype-context

## Backend (Scala)

- `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala` — `listRows` gains
  `limit: Option[Int]` (SQL `LIMIT`) and `excludeKeys: Set[String]` (Postgres `jsonb -` top-level-key
  removal, `SQLActionBuilder#concat`-built, one bound `::text`-cast param per key) so Content-category
  field values never leave Postgres (design.md D1). Defaults preserve the prior unbounded query exactly.
- `backend/src/main/scala/com/helio/services/DataTypeService.scala` — `listRows` forwards the same two
  params to the repo after the existing `findByIdOwned` ownership check (no new RLS surface).
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` — `GET /api/types/:id/rows` gains
  optional `?limit=` (rejects `<= 0` with 400) and `?excludeContentFields=` query params; the latter does
  a second owner-scoped `findById` lookup to compute `excludeKeys` from the DataType's own fields.
- `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` — constructor swapped
  `dataTypeRepo: DataTypeRepository` → `dataTypeService: DataTypeService` (design.md D7); `assemble`'s
  `dataTypes` mapping is now async (`Future.traverse`) and attaches bounded `sampleRows` per
  pipeline-output DataType via the new `sanitizeSampleRows` (private[services], unit-tested directly) —
  source-companion DataTypes get `[]` without a query (D2).
- `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` —
  `WorkspaceContextDataType` gains `sampleRows: Vector[JsObject]` (always present, no `Option`);
  `jsonFormat8` → `jsonFormat9`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `WorkspaceContextService` construction updated
  for the D7 constructor swap.
- `backend/src/test/scala/com/helio/infrastructure/DataTypeRowRepositorySpec.scala` — new cases for
  `limit`/`excludeKeys` (including a multi-key, absent-key, and limit+excludeKeys-combined case) against a
  real embedded Postgres.
- `backend/src/test/scala/com/helio/services/WorkspaceContextServiceSpec.scala` — swapped constructor
  fixture for D7; extracted its inline JSON-Schema-validation harness into `JsonSchemaValidation` (tasks.md
  4.1); added DB-backed sample-rows coverage (4.3 populated/empty/content-exclusion, 4.4 owner-scoping,
  4.5 route-level schema validity with non-empty `sampleRows`).
- `backend/src/test/scala/com/helio/services/WorkspaceContextServiceSanitizeSampleRowsSpec.scala` (new) —
  pure unit tests for `sanitizeSampleRows` (row cap, column cap, Content exclusion, unparseable-dataType
  exclusion, oversized string/non-string cell truncation, empty snapshot). Split into its own file (no DB
  fixture needed) to keep `WorkspaceContextServiceSpec`'s growth in check.
- `backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala` (new) — the extracted
  JSON-Schema-2020-12 validation harness (tasks.md 4.1, pre-approved).
- `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` — new cases for `?limit=`,
  `?excludeContentFields=true`, the omit-both-preserves-prior-behavior case, and `limit=0`/`limit<0` → 400.
- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` — constructor fixture updated
  for the D7 swap.

## MCP (TypeScript)

- `helio-mcp/src/context.ts` — new `sanitizeSampleRows` (exported, independent TS implementation of
  design.md D3's Structured-only/40-column/200-char/`"…[truncated]"` rules) plus `WorkspaceContext`'s
  `dataTypes[].sampleRows` field; `buildWorkspaceContext`'s `dataTypes` mapping is now async and fetches
  bounded sample rows per pipeline-output DataType via `api.getDataTypeRows(id, 5, true)`.
- `helio-mcp/src/helioApi.ts` — `getDataTypeRows` gains optional `limit`/`excludeContentFields` params,
  forwarded as query params.
- `helio-mcp/src/context.test.ts` (new) — unit tests for `sanitizeSampleRows` (parity with the Scala-side
  cases) and for `buildWorkspaceContext`'s sample-rows wiring (populated + capped for a pipeline-output
  DataType via a fake `HelioApi`, `[]` without a `getDataTypeRows` call for a source-companion DataType).

## Schema / contract

- `schemas/workspace-context.schema.json` — `DataTypeEntry.sampleRows` added (array, `maxItems: 5`,
  required — always present, never `Option`), documenting the Structured-only/40-column/200-char rules.

## Infra (test tooling)

- `jest.config.cjs` — added `moduleNameMapper: { "^(\.{1,2}/.*)\.js$": "$1" }` so ts-jest can resolve
  `helio-mcp`'s NodeNext-style `./foo.js` relative imports (which point at `.ts` source files, per that
  package's own `tsconfig.json`) under the root Jest config. Previously `helio-mcp` had zero test files, so
  this mismatch was latent; `helio-mcp/src/context.test.ts` is the first file to exercise it. Root
  `jest.config.cjs`'s `testPathIgnorePatterns` never excluded `helio-mcp/`, so this is the minimal fix
  needed to make the pre-existing (but never-exercised) intent — "root `npm test` covers `helio-mcp`
  unit tests too" — actually work, not a new architectural decision.
