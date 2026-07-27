# HEL-373 — Column statistics per DataType column in workspace context

## Context

Sample rows (sibling HEL-345 ticket) give an agent a peek at values; column
*statistics* let it reason about a whole column cheaply and deterministically —
pick a `sum`-able measure, avoid grouping by a high-cardinality identifier, warn
on a mostly-null column. The stats are computed over the latest pipeline-run
snapshot already exposed by `GET /api/types/:id/rows` (`DataTypeRowRepository` /
`PipelineRunService`).

This adds a compact per-column statistics block to the enriched workspace
context on both the backend assembler (`WorkspaceContextService`, HEL-345
context-endpoint ticket) and the MCP `buildWorkspaceContext`
(`helio-mcp/src/context.ts`).

## Scope

- Backend Scala: extend `WorkspaceContextService` to compute per-column stats
  over the bounded latest-run snapshot: for numeric columns `min`/`max`/`mean`;
  for all columns `nullRate`, `distinctCount`/cardinality (capped, e.g. "100+"),
  and up to K example distinct values. Computation is over the same bounded row
  set used for sampling — no unbounded scans, no new heavy queries.
- MCP TS: mirror the same computation (or consume it from the backend endpoint)
  so both surfaces expose an identical `columnStats` shape.
- schemas: add `columnStats` (keyed by column name) to the DataType entry in
  `schemas/workspace-context.schema.json` with explicit per-field definitions.
- Determinism: identical input rows must yield identical stats (stable ordering
  of example values, fixed rounding for `mean`).
- Tests: backend ScalaTest covering numeric vs non-numeric columns, all-null
  column (nullRate 1.0, no min/max), and cardinality cap; MCP unit test for
  shape parity.

## Acceptance criteria

- [ ] Every DataType column carries `nullRate`, `distinctCount` (capped), and
      example values; numeric columns additionally carry `min`/`max`/`mean`.
- [ ] Stats are computed only over the bounded snapshot (same row bound as
      sampling) — no full-table scan, no new expensive query path.
- [ ] Deterministic output for identical input (verified by test).
- [ ] Backend and MCP expose the same `columnStats` shape (documented shared
      schema or parity test).
- [ ] All-null / empty-snapshot columns handled gracefully (no min/max, nullRate
      defined).
- [ ] `schemas/workspace-context.schema.json` updated; `sbt test` + MCP tests
      green.
- [ ] Backward-compat: additive field only.

## Out of scope

- Semantic/type classification (is-a-date / is-a-measure) and joinability —
  separate HEL-345 ticket (may consume these stats).
- Token budgeting (separate ticket).

## Dependencies

- Builds on the HEL-345 backend workspace-context endpoint ticket; complements
  the sample-rows ticket (shares the bounded snapshot read). Consumed by
  HEL-341 / HEL-342 planners.

---

## Carried findings from the orchestrator brief (ticket 3 of 5 in HEL-345 epic)

Two predecessors shipped — read both before planning, this change extends them
directly:

- **HEL-371** (`4dfa8bee`) built the assembler: `WorkspaceContextService.scala`,
  `WorkspaceContextProtocol.scala`, `WorkspaceRoutes.scala`
  (`GET /api/workspace/context`), `schemas/workspace-context.schema.json`.
  Design record: `openspec/changes/archive/2026-07-26-workspace-context-assembler/`.
- **HEL-372** (`619d4555`) added bounded sample rows:
  `DataTypeRowRepository.scala` (SQL-tier limit + jsonb key-stripping),
  `WorkspaceContextService.sanitizeSampleRows`,
  `helio-mcp/src/context.ts` TS parity, `helio-mcp/src/context.test.ts`.
  Design record: `openspec/changes/archive/2026-07-27-sample-rows-datatype-context/`.

`main` is at `619d4555`. Branch from `main`.

1. **HEL-372's outgoing note, directly for this ticket:** `sanitizeSampleRows`
   in `WorkspaceContextService.scala` is the seam where a similar bounded
   aggregation slots in, and the same **Structured vs Content field-category
   distinction very likely applies to stats too**. Read
   `DataTypeRowRepository.scala`'s jsonb key-stripping first.
2. **Cost bounding is again the central design risk, and it is worse here than
   for HEL-372.** Sample rows were `LIMIT 5`; statistics are inherently a
   **full-scan aggregate over every row**. HEL-217 content connectors store up
   to 10MB of extracted text per row in the same snapshot table
   (`TEXT_MAX_FILE_SIZE_BYTES` / `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES` default to
   `10485760` — verified in `DataSourceService.scala:66-78`). Computing
   `distinct-count` over a 10MB text column would be pathological. Decide
   deliberately: which field categories get which statistics, whether stats are
   computed in SQL (strongly preferred — that is how HEL-372 solved its
   equivalent) or in Scala, and what the worst-case cost is on a large
   DataType. **Bounded by construction, not by hope.** An explicit defended
   answer is required at the design gate, not a default.
3. **spray-json / schema lesson, which cost HEL-371 a full eval cycle:**
   `jsonFormatN` **omits** `Option = None` from the wire rather than writing
   `null`. Any Optional field must NOT be in its `$defs` `required` array —
   keep it in `properties` typed `["T","null"]`. HEL-372 sidestepped this by
   making `sampleRows` always-present (empty collection rather than absent);
   prefer that shape where it fits. Test both the field-**present** and
   field-**absent** branches — absent-only coverage is exactly what let the
   original bug through.
4. **Numeric stats on string data.** CSV sources read all columns as strings at
   runtime even when the schema declares integer. Decide what min/max/mean
   mean for a column typed numeric but holding strings, and don't silently
   produce garbage.
5. **Open pagination finding, belongs to HEL-377, not this ticket:** list calls
   use page size 200 rather than the repo max 500, so >200 of a resource kind
   truncates `items` while `counts` stays correct. Don't fix it here; don't
   make it worse.
6. Keep TS parity in `helio-mcp/src/context.ts` in step with the backend, as
   HEL-372 did, and extend `context.test.ts`.

## Design-gate attention

- **Cost bounding** — the single most important question. Both prior tickets'
  design gates caught real defects on exactly this axis; expect the same
  scrutiny.
- **RLS scoping** — every read owner-scoped. A cross-tenant existence leak was
  found in HEL-363 and a cross-tenant ACL gap in HEL-384.
- **Sensitive data** — "example values" means real user data flowing into LLM
  prompts, same exposure question HEL-372 faced. Address it explicitly either
  way.
