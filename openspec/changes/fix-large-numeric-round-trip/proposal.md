## Why

`DataTypeRowRepository.listRows` re-parses the `data_type_rows.data::text` cast via spray-json's
default `JsonParser`, which caps numeric literal length at 100 characters
(`maxNumberCharacters = 100`). Postgres canonicalizes a large `jsonb` numeric to its full
plain-decimal expansion on `::text` cast, so any stored `float`/`integer` value whose decimal
expansion exceeds that cap throws `ParsingException: Number too long` on read — rows written
successfully become permanently unreadable. This is a real, in-range Postgres value (well within
arbitrary-precision jsonb `numeric`), not an exotic edge case, and it silently corrupts round-trip for any caller
of `listRows` (pipeline snapshots, panel binding, workspace context).

## What Changes

- Fix the read path (`listRows`) so numeric values whose plain-decimal expansion exceeds
  spray-json's default character cap round-trip correctly, without corrupting or truncating the
  value and without weakening validation for any other case.
- Add a boundary-sweep regression test against `DataTypeRowRepository` directly (not through a
  DB-backed service fan-out, per HEL-373's precedent) asserting exact numeric-value equality
  round-trip: just under, at, and over the empirically-determined boundary, negative large
  numbers, high-precision decimals, and at least one ordinary small value.
- Empirically determine and document the real boundary (verify vs. refute the ticket's ">=100
  chars" claim).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `datatype-row-snapshot`: the "Stored snapshot rows are retrievable" requirement is strengthened
  to guarantee round-trip of large-magnitude numeric values, not just ordinary-magnitude ones.

## Impact

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/DataTypeRowRepository.scala`
  (`listRows`) — the only change surface. Corrected caller audit (per design-gate skeptic round
  1 — the prior list was wrong): `listRows` is called by `DataTypeService.scala:52`,
  `PanelCapabilityService.scala:46`, and transitively by `WorkspaceContextService.scala:342` (via
  `DataTypeService`) — these three inherit the fix automatically. `PipelineRunService.scala:523`
  and `BoundPanelService.scala:313` call `overwriteRows` only (the write path, already unaffected
  by this defect) — they do NOT call `listRows` and are not evidence for this fix.
- No schema/migration change anticipated (see design.md — if one turns out to be required, this
  proposal escalates to the human before implementation per ticket constraints).

## Non-goals

- Widening scope to other unrelated `.parseJson` call sites (checked; none share this defect —
  see design.md).
- Changing the write path (`overwriteRows`) or the `data_type_rows` column type.
