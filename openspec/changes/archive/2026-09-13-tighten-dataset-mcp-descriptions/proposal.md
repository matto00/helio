## Why

HEL-1081's dataset MCP tools shipped with three description/behavior mismatches an agent can trip
on: `append_dataset_rows` overstates rejection behavior for short rows, dataset creation silently
drops an explicit `default: null`, and no tool tells an agent which column `type` strings are
valid. Verified against real backend code and confirmed via a fresh MCP process (see
`ticket.md`'s premise-validation summary and `design.md`).

## What Changes

- Correct `append_dataset_rows`'/`replace_dataset_rows`' tool descriptions in `helio-mcp` to state
  the real padding behavior: a row shorter than the declared schema, OR containing an explicit
  `null` at a position, has that field filled from its declared `default` (or left `null` if
  optional with no default) — only a row LONGER than the schema, a declared-type mismatch on a
  present non-null value, or a genuinely missing/null required field with no default, is rejected.
- Document, in `create_data_source`'s tool description, that an explicit `default: null`
  supplied at dataset creation is currently indistinguishable from "no default" (a known
  `StaticColumnPayload` wire-format limitation), and that `update_dataset_schema` should be used
  afterward if that distinction matters — no backend wire-format change; documented as a
  limitation since fixing it would touch a widely-used payload type disproportionate to a
  docs-tightening ticket.
- Add an enumeration of the 7 canonical column `type` strings to the relevant dataset tool
  descriptions (`create_data_source`, `get_dataset_schema`, `update_dataset_schema`), sourced from
  a new `helio-mcp`-local constant kept honest against the backend's
  `DataFieldType.CanonicalWireValues` by a drift-guard test mirroring
  `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts` (HEL-1079) — never a
  hand-copied literal with no guard.

## Capabilities

### Modified Capabilities

- `mcp-data-source-tools`: tighten the `append_dataset_rows`/`replace_dataset_rows` row-rejection
  requirement's wording to state the real short-row-padding behavior, and add a requirement that
  dataset tool descriptions enumerate the valid column `type` strings from a guarded source of
  truth.

## Non-goals

- Changing `append_dataset_rows`' actual validation/padding behavior (the backend behavior is
  correct and intentional; only the description was wrong).
- Fixing `StaticColumnPayload`'s inability to express an explicit `default: null` at creation time
  (documented as a known limitation, not fixed — out of proportion for this ticket).
- HEL-1132 ("DataType" terminology copy) — separate ticket, not folded in here.

## Impact

- `helio-mcp/src/tools/write.ts`, `helio-mcp/src/tools/read.ts` (tool descriptions).
- New `helio-mcp` source-of-truth constant + drift-guard test for canonical column types.
- `openspec/specs/mcp-data-source-tools/spec.md` (delta: row-rejection wording, column-type-list
  requirement).
