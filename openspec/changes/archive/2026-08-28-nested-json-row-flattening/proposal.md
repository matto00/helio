## Why

A `rest_api` source over nested JSON registers a DataType whose fields are flattened to dot notation
(`stats.pts_ppr: float`) but whose rows never carry those columns — the nested object arrives as a raw JSON
string under the top-level key. Every consumer of a dotted column silently receives `null`. The cause is a
duplicated traversal: `SchemaInferenceEngine.flattenObject` recurses, `PipelineRowJson.jsRowToRow` does not.
Field testing against the live Sleeper NFL API hit this as a hard blocker and abandoned Helio pipelines
entirely in favour of pre-flattening to CSV outside the product.

## What Changes

- Extract the nested-object traversal both paths need into one shared helper. Schema inference and row
  materialisation consume the same leaf enumeration, so a nested field appearing in one necessarily appears
  in the other — the duplication that caused this bug is removed rather than duplicated again.
- Row materialisation expands nested objects into dotted columns, matching what inference already promises.
- Define nested-array behaviour deliberately: arrays terminate traversal as leaves (both array-of-scalars and
  array-of-objects), preserving today's inference behaviour exactly. Index-expansion is rejected because
  per-row array lengths would make the column set depend on row ordering.
- Bound traversal depth, with a defined and tested behaviour at the bound (the remaining subtree becomes a
  leaf, identically in both paths).
- Selector failure (`rootSelector` path missing, or descending through a non-object) yields a curated
  `fetchError` through the existing HEL-468 envelope instead of today's silent empty success.

## Capabilities

### New Capabilities

- `nested-json-flattening`: the shared bounded traversal that enumerates a JSON object's leaves as dotted
  paths, and the guarantee that schema inference and row materialisation are generated from it — including
  array-as-leaf, the depth bound, and dotted-key collision resolution.

### Modified Capabilities

- `schema-inference`: JSON inference's nested flattening is restated as delegating to the shared traversal,
  with array and depth-bound behaviour made explicit rather than incidental.
- `rest-api-connector`: selector failure is upgraded from "zero rows plus a server-side log" to a curated
  `fetchError`, the extension the existing requirement already names HEL-599 as the owner of.
- `pipeline-run-execution`: `rest_api`/`sql` base-source row materialisation carries dotted columns for
  nested responses.

## Impact

- `SchemaInferenceEngine.flattenObject`, `PipelineRowJson.jsRowToRow`, `RestApiConnectorDriver.toRows` and
  its three call sites, `InProcessPipelineEngine.loadRows`.
- No migration, no wire-format change, no frontend change. Flat responses are unaffected; only rows
  containing a nested `JsObject` change shape, and they change to match the schema already advertised.

## Non-goals

- HEL-858's recursive, type-widening inference merge across sampled rows. The shared helper is shaped so 858
  extends it; the widening itself is not implemented here.
- Making `compute`/`filter` expressions able to reference a dotted column. The expression lexer does not
  admit `.` in an identifier, so that stays broken after this change; `rename` is the workaround and a
  spinoff ticket is filed. Key-addressed steps (`select`, `lookup`, `sort`, `dedupe`) work as soon as the
  columns exist.
- Pagination, OAuth2, rate-limit, and a general-purpose transform language.
