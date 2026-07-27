## Why

Sample rows (HEL-372) give an agent a peek at a few values; they don't let it reason about a whole
column cheaply — pick a `sum`-able measure, avoid grouping by a high-cardinality identifier, or notice a
mostly-null field. Per-column statistics close that gap deterministically, without the agent pulling and
eyeballing the full row snapshot itself.

## What Changes

- Extend `WorkspaceContextService` (backend) to compute a `columnStats` block per DataType column, over
  the same bounded, SQL-tier-limited row fetch already used for `sampleRows` (single query serves both;
  no new query path). Content-category columns (`string-body`/`binary-ref`, HEL-217) are excluded from
  `columnStats`, mirroring `sampleRows`'s existing exclusion, for the same worst-case-cost reason.
- `columnStats[<column>]` carries `nullRate`, `distinctCount` (capped) + `distinctCountCapped`, and up to
  5 example values for every Structured-category column; `min`/`max`/`mean` additionally for numeric
  (`integer`/`float`) columns, with a defined fallback when a numeric column holds unparseable strings
  (CSV-sourced data can hold numeric columns as strings at runtime).
- Mirror the identical computation in `helio-mcp/src/context.ts`'s `buildWorkspaceContext`, from the same
  single row fetch already made for `sampleRows`.
- `schemas/workspace-context.schema.json`: add `columnStats` (object keyed by column name) to the
  `DataTypeEntry` def, with explicit per-field definitions; `min`/`max`/`mean` are optional
  (spray-json omits `None`, never emits `null` — must not be in `required`).
- Backend ScalaTest + MCP unit tests: numeric vs. non-numeric columns, all-null column, cardinality cap,
  empty snapshot, determinism (identical input rows -> identical stats).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-context-assembly`: adds bounded per-column statistics (`columnStats`) to each
  `dataTypes[]` entry, computed over the same bounded snapshot fetch `sampleRows` already uses.

## Impact

- Backend: `WorkspaceContextService.scala` (new `computeColumnStats`, raises the shared row-fetch limit
  from 5 to a documented larger bound used for stats; `sampleRows` still reports only the first 5 of that
  same fetch — unchanged behavior/wire-shape for existing consumers), `WorkspaceContextProtocol.scala`
  (new `WorkspaceContextColumnStats` case class + format), `WorkspaceContextServiceSpec.scala`.
- Schema: `schemas/workspace-context.schema.json`.
- MCP: `helio-mcp/src/context.ts` (new `computeColumnStats`), `helio-mcp/src/context.test.ts`.
- No migration, no database schema change, no new repository method (reuses
  `DataTypeRowRepository.listRows`'s existing `limit`/`excludeKeys` params from HEL-372).

## Non-goals

- Semantic/type classification (is-a-date / is-a-measure) and joinability (separate HEL-345 ticket).
- Token budgeting for the overall context payload (separate ticket).
- Statistics computed over a DataType's true full row count when it exceeds the bounded fetch — an
  explicit, documented approximation (see design.md), not a defect.
