# HEL-890: Secondary-source truncation reports contradictory structured fields and drops the per-source detail

## Description

Found during the HEL-857 exit-criterion rebuild, against production on `v0.7.6`. HEL-861 works — this is about the shape of what it reports when the truncated read is a **secondary** source (a `lookup`/`join`/`union` reference), not the primary.

A pipeline over the 100-row trending feed, with a `lookup` against the 3,114-row projections source returned:

```json
{
  "rowCount": 100,
  "sourceRowCount": 100,
  "truncated": true,
  "availableRowCount": 100,
  "truncationNotice": "Source \"Sleeper Projections 2026\" truncated: this run read the first 1000 rows returned, out of 3114 available…"
}
```

The prose is correct and genuinely useful. The structured fields next to it are not:

* `truncated: true` alongside `sourceRowCount: 100` and `availableRowCount: 100` reads as "truncated, but read all 100 of 100". An agent branching on `availableRowCount > sourceRowCount` concludes nothing was lost, which is the opposite of the truth.
* `availableRowCount` is the **primary's** count (`PipelineRunService.truncationFields` returns `primaryStats.availableRowCount`), while `truncated` is the OR across primary *and* secondaries. The two fields describe different things and are presented as a pair.

`truncationFields` builds a `truncatedReads` vector — one entry per truncated source with its name, rows read, and rows available — which is exactly the machine-readable form that would resolve this, and it is already on the backend wire (`RunResultResponse.truncatedReads`). The MCP layer drops it: `helio-mcp/src/helioApi.ts` `runPipeline` maps only `availableRowCount: result.sourceAvailableRowCount`, and `helio-mcp/src/types.ts`'s `RunResultResponse` does not even declare `truncatedReads`.

The nulls in the field report were real data loss with a real cause: the lookup reference was capped at 1000 of 3114, so any trending player outside the top 1000 by projected points could not be resolved. Anyone reading only the structured fields would conclude the run was complete.

## Premise validation (orchestrator, pre-Planning)

Verified against the live tree before any code was written. Full record: `.concertino/runs/HEL-890/evidence/premise-validation.md`. Verdict: **minor-staleness** — every mechanism claim CONFIRMED, with two corrections that bind this change:

1. The MCP drop site is `helio-mcp/src/helioApi.ts:616` (ticket said `:595`) and the field is additionally absent from the `RunResultResponse` interface in `helio-mcp/src/types.ts`, so it is dropped at the type boundary as well as the mapping.
2. AC3's stated reason is wrong, and the orchestrator's first correction of it was ALSO wrong (caught by
   design-gate skeptic round 1). Ground truth, read directly: `PipelineRunServiceSpec.scala:1513-1528` covers a
   secondary-source truncation (`previewStep` over a `union`) and asserts BOTH `sourceTruncated shouldBe true` AND
   `response.truncatedReads.map(_.dataSourceName) should contain("ds-rest")`. A second test (~line 1537) pins
   `truncatedReads` **contents** for a three-source run. So `truncatedReads` is already covered on the backend at the
   name level. What is NOT covered anywhere is the per-entry numeric detail (`rowsRead`, `availableRowCount`) on a
   secondary, and the whole MCP surface. New coverage must isolate to those, or it re-proves existing coverage.
3. No schema migration is required by this change. No Flyway file may be added or edited.

## Acceptance criteria

- [ ] AC1 — The structured fields are self-consistent. Either `availableRowCount`/`sourceRowCount` describe the same source as `truncated`, or the top-level scalars are scoped to the primary and the cross-source signal is named distinctly — **decide and document which**, rather than leaving a reader to infer it.
- [ ] AC2 — `truncatedReads` (name, rowsRead, availableRowCount per source) reaches the MCP `run_pipeline` result, so the per-source truth is machine-readable and not prose-only.
- [ ] AC3 — A test covers the secondary-source case specifically: primary NOT truncated, secondary truncated.
- [ ] AC4 — `run_pipeline`'s tool description states what `availableRowCount` is scoped to.
- [ ] AC5 — Verified by measurement on a two-source pipeline, asserting the emitted fields cannot be read as "nothing was lost" — not by asserting the notice string alone.

## Evidence standard (binding, from the coordinator)

Tonight's runs repeatedly produced green checks that discriminated nothing. Before any test is accepted as proof:

- **Confirm the red arm can actually fire.** A mutation that cannot go red is an instruction to weaken the assertion until it passes. Check this before demanding the mutation, not after.
- **Confirm the failure isolates to the intended step.** A mutation that turns CI red at `npm run lint` before the gate runs proves the lint gate works and nothing else.
- **Two mutations producing the same observation are one axis wearing two labels**, not two independent checks.
- A test that re-derives its expected value from the same source as the implementation asserts nothing.
- This ticket is about **reporting**. Be precise about what the correct output is *for each field*, and assert the actual emitted structure — a truncation report that is merely present is not one that is correct.

## Scope constraints

- Binding: `CONTRIBUTING.md` (no inline fully-qualified names in Scala), `CLAUDE.md`'s API-contract rules, `DESIGN.md` for any frontend work.
- Concurrent runs on this machine are touching the ACL path, `schemas/`, `openspec/` specs, dashboard/panel frontend (HEL-590), and possibly `PipelineStepRepository` reorder semantics. If this change needs to touch any of those, STOP and escalate rather than racing.
- All worktrees share one Postgres and one `flyway_schema_history` (main at V101). Never edit an applied migration.
