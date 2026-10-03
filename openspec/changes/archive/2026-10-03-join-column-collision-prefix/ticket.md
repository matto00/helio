# HEL-1236: Join step silently overwrites left columns with right columns of the same name

## Description

Follow-up from HEL-1069 (origin_kind: followup, origin_ticket: HEL-1069).

HEL-1069's probe (scenario H): `JoinStep` merges rows as `leftRow ++ rightRow`, so when both lanes carry a column with the same name (e.g. both aggregate branches alias `cnt`), the right value silently overwrites the left (value wrong or missing) with no error or warning at run or analyze time.

Ask: decide and implement explicit collision semantics (reject at validation/analyze, or require/produce a disambiguating prefix), so a join never silently drops a column.

## Owner ruling (2026-10-03, binding)

Auto-prefix the right side. On a column-name collision, the join keeps the left column and renames the right-side column with a deterministic prefix (e.g. `right_cnt`). It never errors and never silently drops a value. The owner knowingly accepts that this renames columns in existing pipelines.

## Acceptance criteria

- No join silently drops a value.
- Red first: a collision test on main shows the overwrite.
- Green: both values present with deterministic names.
- Apply/infer parity test passes (runtime row columns == analyze-inferred columns).
- Mutation: removing the prefixing turns the tests red.
- Collision-proof naming (right_cnt already present, several collisions) is deterministic, documented, tested.
- Rename surfaced everywhere schemas are computed: analyze, editor columns, Output field pickers, analyze_pipeline MCP output; Spark path if joins run there.
- Dev DB (read-only) inventory of existing joins with collisions; explicit rule for the join key column.
- PR body explains for the owner what happens to Outputs/panels bound to an overwritten right-side column, confirmed against real code paths.
