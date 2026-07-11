## Context

`PanelRepository.replace` (`backend/.../PanelRepository.scala:199-209`) and
`PanelMutationOps.batchUpdate`'s config-patch branch (`backend/.../PanelMutationRepository.scala:98-109`,
mixed into `PanelRepository` via self-type) both write the full set of typed-config columns after
`PanelConfigCodec.applyConfigPatch` produces an updated in-memory `Panel`. Both call
`PanelRowMapper.domainToRow` to get a `PanelRow`, then hand-write a Slick `.map(r => (...)).update((...))`
column tuple. `replace` was fixed in HEL-292 to include `r.aggregation` / `row.aggregation`;
`batchUpdate` was not, so a patched aggregation spec is silently dropped on the batch path.

## Goals / Non-Goals

**Goals:**
- Add `aggregation` to `batchUpdate`'s config-patch column tuple so it persists at parity with `replace`.
- Make the two write paths structurally unable to drift again: one shared definition of "the config
  column list," referenced by both `replace` and `batchUpdate`.
- Add a regression test that fails on `main` (pre-fix) and passes after: batch-patch a metric or chart
  panel's `aggregation`, reload, assert it persisted.

**Non-Goals:**
- No change to `PanelConfigCodec.applyConfigPatch`, the aggregation domain model, or the wire schema —
  the patch is computed correctly in memory; only the write-back column list is incomplete.
- No broader refactor of `PanelRepository`/`PanelMutationRepository` beyond this shared column list.

## Decisions

- **Shared column list as two companion functions on `PanelRepository`**: add
  `configColumnsOf(r: PanelTable)` (returns the Slick column tuple: `typeId, fieldMapping, content,
  imageUrl, imageFit, dividerOrientation, dividerWeight, dividerColor, aggregation`) and
  `configColumnValuesOf(row: PanelRow)` (returns the matching value tuple) in the `PanelRepository`
  object, alongside the existing `PanelRepository` companion-object implicits. Both `replace` and
  `batchUpdate`'s config-patch branch call these instead of hand-writing the tuple.
  - *Alternative considered*: a shared `case class ConfigColumns(...)` with its own Slick `Shape`.
    Rejected — more ceremony than the two-function approach for one extra column, and Slick already
    supports nested-tuple shapes (`(configColumnsOf(r), r.lastUpdated)`) up to the 22-element limit,
    which is far from being hit.
  - *Alternative considered*: a runtime test that asserts the two column lists are structurally equal
    (e.g. via reflection). Rejected in favor of eliminating the duplication outright — a single
    source of truth is a stronger guarantee than a test that could itself go stale.
- **Regression test location**: extend the existing `PanelMutationRepository`/`PanelRepository`
  backend test suite (wherever `batchUpdate`'s config-patch path is already covered) rather than
  adding a new suite, so the new test sits next to its existing siblings and shares fixtures.

## Risks / Trade-offs

- [Nested-tuple Slick `.map`/`.update` shape may need an explicit import or slightly different call
  shape than a flat tuple] → mitigate by keeping `configColumnsOf`/`configColumnValuesOf` returning
  the *same* arity/order as today's flat tuples if nesting proves awkward in practice; either form
  satisfies "single shared definition."
- [Adding `aggregation` to the batch write path changes behavior for any *existing* batch config-patch
  callers that rely on aggregation being ignored] → none expected; this is a straightforward bug fix
  restoring intended behavior, not new behavior, and no caller could reasonably depend on their
  aggregation edits being silently dropped.

## Planner Notes

- Self-approved: this is a same-class-of-bug parity fix with a well-defined blast radius (two
  functions, one shared helper, one test). No escalation-worthy architecture change, external
  dependency, or breaking API change is involved.
