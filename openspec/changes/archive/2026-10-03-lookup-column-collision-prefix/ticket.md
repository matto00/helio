# HEL-1250: Lookup step silently overwrites left columns with looked-up columns of the same name

## Description
Follow-up from HEL-1236 (origin_kind: followup, origin_ticket: HEL-1236). HEL-1236 made the join step auto-prefix colliding right-side columns (`right_<name>`, via `JoinColumnNaming`). `LookupStep` has the same merge (`leftRow ++ brought`) and still silently overwrites a same-named left column with the looked-up value, in the runtime and in analyze-time inference (`inferLookup`). Decide and implement collision semantics for lookup, reusing the shared rule so runtime/analyze stay in parity. This renames columns in existing pipelines, same trade-off as HEL-1236.

## Owner ruling (2026-10-03, binding)
Same as join. Reuse HEL-1236's `JoinColumnNaming.resolve` so clashing looked-up columns become `right_<name>`, then `right_<name>_2`..., in sorted-name order. One rule for both steps across runtime `LookupStep`, analyze-time `inferLookup`, and Spark if lookup executes there. Accepted caveat: a panel bound to a clashing name now reads the left/base value.

## Acceptance criteria
- Red first: a collision test on main shows the overwrite.
- Green: both values are present with deterministic names.
- A parity test (runtime evaluate vs `PipelineAnalyzeService.analyzeNodes`) passes over the cases: no collision, single, several, `right_x` already on left, on right, on both, key only.
- Mutation: disabling the prefixing in the shared helper turns the lookup tests red as well as join's.
- Check whether lookup's analyze needs `secondarySourceSchemas` pre-resolution; check Spark; read-only dev-DB inventory of existing colliding lookup steps; document lookup's key semantics in design.
