## Why

Structure, sample rows, and column stats (HEL-371/372/373) give an agent raw material but no
interpretation: it still has to guess which column is a date, which is a group-by dimension, and
whether two DataTypes share a joinable key. Wrong guesses here directly produce wrong panel/shape
choices and missed join opportunities for the upcoming agent-authored pipeline planner (HEL-342).

## What Changes

- `WorkspaceContextService` classifies each column's `semanticRole` (`temporal` / `dimension` /
  `measure` / `identifier` / `boolean` / `text`) from declared `dataType` + name heuristics +
  `columnStats` signals (cardinality, null rate) already computed by HEL-373.
- `WorkspaceContextResponse` gains a workspace-level `joinHints` array: bounded, pairwise
  name+type+value-overlap comparisons across pipeline-output DataTypes' columns, each hint carrying a
  `confidence` score and both sides' `dataTypeId`/`column`.
- `helio-mcp/src/context.ts` mirrors both derivations for parity (independent TS implementation, per
  the existing no-shared-runtime pattern).
- `schemas/workspace-context.schema.json` gains `semanticRole` per column and top-level `joinHints`,
  documented as inferred/advisory.
- All new fields are additive; the authoritative column `dataType` is never mutated by a hint.

## Capabilities

### New Capabilities

(none — this extends the existing workspace-context-assembly capability)

### Modified Capabilities

- `workspace-context-assembly`: adds a `semanticRole` classification requirement per column and a
  bounded, owner-scoped `joinHints` requirement across a caller's own pipeline-output DataTypes.

## Impact

- Backend: `WorkspaceContextService.scala`, `WorkspaceContextProtocol.scala` (new `semanticRole` field +
  `WorkspaceContextJoinHint`/`joinHints`), `WorkspaceContextServiceSpec.scala`.
- MCP: `helio-mcp/src/context.ts`, `helio-mcp/src/context.test.ts`.
- Schema: `schemas/workspace-context.schema.json`.
- No new endpoints, no new database access — computed entirely from data `assemble` already fetches
  (declared fields + the existing bounded row/stats fetch, HEL-372/373).

## Non-Goals

- Automatically authoring a join pipeline step (HEL-342).
- Token budgeting for the overall context payload (separate ticket).
- Exact/complete join detection — this is a bounded heuristic, explicitly advisory.
