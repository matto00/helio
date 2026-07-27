# HEL-374 — Type/semantic + relationship (joinability) hints in workspace context

## Context

Structure + sample rows + column stats (sibling HEL-345 tickets) give an agent the raw material; this
ticket adds derived, opinionated hints that directly steer shape/panel choice and future joins:

- **Semantic role** per column: `date`/`temporal`, `category`/`dimension`, `measure`/`numeric`,
  `identifier`, `boolean`, `text` — so the planner knows a timeline needs a temporal column, a metric
  needs a measure, grouping wants a dimension not an id.
- **Relationship / joinability hints**: which columns across DataTypes look joinable (name + type +
  value-overlap heuristic over the bounded snapshots), so a combined proposal (HEL-342) can suggest a
  join step.

These are heuristics computed from the already-assembled structure + stats + sample rows; they are
advisory, clearly labelled as inferred, and never override the authoritative column `dataType`.

## Scope

- Backend Scala: extend `WorkspaceContextService` with a `semanticRole` per column (derived from
  declared `dataType` + column-name heuristics + stats such as cardinality/nullRate) and a
  workspace-level `joinHints` list `[{ leftDataTypeId, leftColumn, rightDataTypeId, rightColumn,
  confidence }]` from a bounded name/type/value-overlap heuristic.
- MCP TS: mirror the same hints in `buildWorkspaceContext` (or consume from the backend endpoint) for
  shape parity.
- schemas: add `semanticRole` to each column and a top-level `joinHints` array in
  `schemas/workspace-context.schema.json`; describe every hint as INFERRED/advisory.
- Bound the join-hint search (cap pairs considered) so it stays cheap on larger workspaces.
- Tests: ScalaTest for role classification across representative columns (date string, high-cardinality
  id, low-cardinality category, numeric measure, boolean) and for a detected join between two
  overlapping id columns; MCP parity test.

## Acceptance criteria

- [ ] Each column carries a `semanticRole` from a fixed enum; classification rules are documented and
      deterministic.
- [ ] `joinHints` surfaces plausible cross-DataType column pairs with a confidence score; the pair
      search is bounded (documented cap).
- [ ] Hints are labelled inferred/advisory and never mutate the authoritative `dataType`.
- [ ] Backend + MCP expose the same shape (schema or parity test).
- [ ] `schemas/workspace-context.schema.json` updated; `sbt test` + MCP tests green.
- [ ] Backward-compat: additive fields only.

## Out of scope

- Automatically authoring a join step (that is HEL-342's combined-proposal concern; this only surfaces
  the hint).
- Token budgeting (separate ticket).

## Dependencies

- Builds on the HEL-345 context-endpoint (HEL-371), sample-rows (HEL-372), and column-stats (HEL-373)
  tickets (consumes their outputs). Consumed by HEL-341 / HEL-342 planners.

## Carried findings from HEL-373 (read in full before planning)

1. `asNumeric` is structurally sound (single `.filter(_.isFinite)` at its exit) and must not be
   re-patched. Reuse it for any numeric parsing; do not write a second parser.
2. Guard invariants at terminal boundaries, not per-intermediate-step — the pattern behind `asNumeric`
   and `WorkspaceContextColumnStats` construction. Follow it for anything new.
3. A finiteness guard is not automatically sufficient — `math.round(Double): Long` clamps `Infinity` to
   `Long.MaxValue`, a finite-but-fabricated value that passes `isFinite`. Ask what happens on overflow
   *before* the guard for any new numeric arithmetic (e.g. overlap-ratio confidence scores).
4. Cross-language parity (backend Scala vs. `helio-mcp/src/context.ts`) is a hard requirement and must be
   tested — mirror any new derived value with equivalent both-sides coverage, including tie-break/edge
   cases.
5. Confidently-worded but false documentation misled reviewers three times in HEL-373. Write
   documentation only for what has been verified; state uncertainty explicitly otherwise.
6. Structured vs. Content field-category distinction: content fields can hold up to
   `TEXT_MAX_FILE_SIZE_BYTES` (10 MB default). Semantic inference must never pull content values — reuse
   the SQL-tier `excludeKeys` mechanism.
7. Known limitation, do not trip over it: HEL-630 — values whose plain-decimal expansion exceeds 100
   chars fail to round-trip. Avoid DB-backed tests with huge numerics; prefer pure-unit specs for extreme
   numeric cases (a DB-backed spec poisoned 8 unrelated tests in HEL-373's first attempt).
8. Pagination finding (page size 200 vs. repo max 500) belongs to HEL-377 — don't fix, don't worsen.

## Design-gate attention

- **Cost bounding.** Joinability hints are the first thing in this epic that compares DataTypes to each
  other rather than summarizing one — naively O(n²) over up to 200 DataTypes x their columns. Defend the
  complexity explicitly and bound it by construction.
- **Inference correctness.** A wrong semantic role is worse than no hint. Decide what confidence
  threshold justifies emitting a hint, and what happens when signals conflict.
- **RLS scoping.** `DataTypeRowRepository.listRows` runs on the privileged pool
  (`ctx.withSystemContext`), which bypasses RLS — owner scoping rests entirely on the app-layer
  `findByIdOwned` choke point with no database backstop. Joinability compares *across* DataTypes, making
  cross-tenant leakage a live risk in a way it wasn't for per-DataType summaries. Trace every path by
  reading the call graph, not by inference — this is an explicit final-gate verification item.
