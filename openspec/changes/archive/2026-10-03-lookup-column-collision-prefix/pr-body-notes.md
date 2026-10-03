# PR body notes (HEL-1250)

## What changed
`lookup` now uses the shared `JoinColumnNaming` rule (new core `resolveWithKey`; `resolve` delegates, join unchanged) at runtime (`LookupStep.evaluate`) and analyze time (`PipelineAnalyzeService.inferLookup`): a requested column that collides with a left column is brought in as `right_<name>` (then `right_<name>_2`, ..., sorted-name order). The left column is never overwritten.

## What bound Outputs/panels now read (verified against code)
Before: on a clashing name the BROUGHT value won on matched rows, and `null` won on unmatched rows (`leftRow ++ nulls`). After: the clashing name reads the left/base value on every row, and the looked-up value lives under `right_<name>`. A panel/Output bound to a clashing name therefore silently reads the left value now (owner-accepted caveat, same trade-off as HEL-1236); re-bind to `right_<name>` to keep reading the looked-up value. Dev DB has 0 lookup steps (dev-db-inventory.md); production was not inspected.

## Key semantics
- Right names are the requested `columns` (config-declared), identical at runtime and analyze; a requested column absent from the reference rows still yields a null column.
- The reference key is only brought if listed in `columns`. The brought copy is dropped (left key kept once, also on unmatched rows, fixing the old null-overwrite of the key) only when `sourceKey == lookupKey`, the key is requested and the left carries it. When `sourceKey != lookupKey`, a requested column named `lookupKey` is ordinary and prefixes on collision.
- Lane-kind analyze types stay keyed by the ORIGINAL requested name.

## Findings
- Spark: `SparkJobSubmitter` has no lookup handling; nothing to change.
- `secondarySourceSchemas`: not needed for lookup (names are config-declared; pre-resolution would only improve the placeholder `string` type). `sourceDependencyOf` stays join-only; the parity test with a source-kind secondary and no pre-resolution agrees.
- Client-side mirrors (frontend stepNarrowing/LookupConfig, helio-mcp, ProvenanceService, PatchSetPreviewProjectionSteps, cost estimator): grep shows only config/op handling, no column computation; nothing to align.

## Documented divergence
Empty left input: runtime sees no left columns, so nothing is renamed (and no rows exist); analyze renames from the declared schema (`right_<name>`). Same as join's documented divergence.

## Evidence
red-first, mutation: evidence.md.
