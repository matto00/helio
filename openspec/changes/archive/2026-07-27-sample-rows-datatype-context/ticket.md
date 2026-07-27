# HEL-372 — Sample rows per DataType in workspace context

## Context

`get_workspace_context` / `buildWorkspaceContext` (`helio-mcp/src/context.ts`) and the new backend assembler (HEL-345 context-endpoint ticket) describe DataType *structure* (column names/types) but nothing about the *values*. An agent proposing a dashboard cannot tell a boolean flag column from a category, or whether a "date" column is ISO timestamps or epoch millis, without seeing real rows. The backend already exposes the latest pipeline-run snapshot via `GET /api/types/:id/rows` (MCP `get_data_type_rows`, `PipelineRunService`/`DataTypeRowRepository`).

This ticket adds a bounded set of **sample rows** per DataType to the enriched workspace context, on both the backend endpoint and the MCP builder.

Touches: `WorkspaceContextService` (backend), `helio-mcp/src/context.ts` + `types.ts`, `schemas/workspace-context.schema.json`, and the row source (`DataTypeRowRepository` / `get_data_type_rows`).

## Scope

* Backend Scala: extend `WorkspaceContextService` to attach up to N sample rows per pipeline-output DataType, read from the existing latest-run snapshot repo (no new persistence). N is a bounded constant/config (default e.g. 5), never unbounded.
* MCP TS: extend `buildWorkspaceContext` to fetch + attach the same bounded sample rows (reusing `api.getDataTypeRows`), keeping the two implementations shape-identical.
* Redaction/size guard: cap per-cell string length and total sample payload so a wide/large row set cannot blow the context (coordinate the hard cap with the token-budget ticket).
* schemas: add `sampleRows` (array, bounded) to the DataType entry in `schemas/workspace-context.schema.json`.
* Tests: backend ScalaTest that sample rows appear only for DataTypes with a successful run snapshot and respect the row cap; MCP unit test that the field is populated + truncated.

## Acceptance criteria

- [ ] Each pipeline-output DataType in the context carries up to N sample rows (N bounded, documented); DataTypes with no run snapshot carry an empty array, not an error.
- [ ] Per-cell and per-DataType size caps enforced; verified by a test with an oversized row.
- [ ] Backend endpoint and MCP `get_workspace_context` return the same `sampleRows` shape (parity test or documented shared schema).
- [ ] Only rows the caller is authorized to read are included (RLS via the existing rows repo/endpoint).
- [ ] `schemas/workspace-context.schema.json` updated; `sbt test` and MCP tests green.
- [ ] Backward-compat: additive field only; consumers ignoring `sampleRows` are unaffected.

## Out of scope

* Aggregated column statistics (separate ticket) — this is raw sample rows only.
* Semantic/type inference (separate ticket).
* Deterministic global truncation strategy (token-budget ticket owns the cross-field budget; this ticket only enforces its own local caps).

## Dependencies

* Builds on the HEL-345 backend workspace-context endpoint ticket (foundation, HEL-371, already shipped — see `openspec/changes/archive/2026-07-26-workspace-context-assembler/`). Consumed by HEL-341 and HEL-342 planners.

## Additional orchestrator context (not part of ticket text)

- Ticket 2 of 5 in HEL-345 "Richer Agent Grounding" epic. HEL-371 shipped the foundation:
  - `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` — the assembler
  - `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` — wire types
  - `backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala` — `GET /api/workspace/context`
  - `schemas/workspace-context.schema.json` — the contract
  - `backend/src/test/scala/com/helio/services/WorkspaceContextServiceSpec.scala` — includes a real JSON-Schema-2020-12 validation harness; reuse it
  - `openspec/changes/archive/2026-07-26-workspace-context-assembler/` — full design record
- Remaining epic tickets — HEL-373 (column stats), HEL-374 (semantic/joinability hints), HEL-377 (token budget) — layer onto the same per-DataType structure, so keep the extension seam clean.

### Carried findings (must account for)

1. **spray-json Option lesson (cost a full eval cycle on HEL-371):** spray-json's `jsonFormatN` **omits** `Option = None` from the wire entirely rather than writing `null`. Any Optional field added must NOT appear in its `$defs` `required` array — keep it in `properties` typed `["T","null"]`, matching the `panel.schema.json` `dataAsOf` convention. Write the schema-validation test for both the field-present and field-absent branches; absent-only coverage is what let the original bug through.
2. **Open pagination finding from HEL-371's final gate (belongs to HEL-377, NOT this ticket):** list calls use the MCP's default page size (200) rather than the repo max (500), so a workspace with >200 of a resource kind gets a truncated `items` array while `counts` still reports the true total. Do not fix here, but do not make it worse.
3. **Row-count bounding is the whole design risk here.** Sample rows are unbounded user data. Decide deliberately: how many rows, how wide a cell, what happens with a 500-column DataType, and whether sampling reads the latest pipeline-run snapshot. Cost and payload size must be bounded by construction, not by hope.
4. `WorkspaceContextServiceSpec.scala` is already 431 lines, past CONTRIBUTING's ~400-line guidance. If this work pushes it well past that, extracting the schema-validation harness into a shared test helper is pre-approved.

### Design-gate attention (skeptic must probe these explicitly)

- **Bounding and cost** — an explicit, defended answer is required, not a default.
- **RLS scoping** — sample rows are real user data; every read must be owner-scoped. A cross-tenant existence leak was found in HEL-363 and a cross-tenant ACL gap in HEL-384. Do not repeat.
- **Sensitive data exposure** — this endpoint now returns actual row values, which will land in LLM prompts. Consider whether that warrants any opt-out or redaction affordance, and say so either way.
