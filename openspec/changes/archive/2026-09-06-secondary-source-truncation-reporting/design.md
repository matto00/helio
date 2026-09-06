## Context

Backend truth is already correct and already on the wire. `PipelineRunService.truncationFields`
(`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:120-141`) returns
`(allReads.nonEmpty, primaryStats.availableRowCount, notice, allReads.map(TruncatedReadResponse(...)))`, and
`RunResultResponse` (`backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:216`) carries
`truncatedReads`. Its scaladoc already states the run-wide / primary-only split, and
`openspec/specs/pipeline-run-truncation-reporting/spec.md` already normatively fixes that split.

The defect is entirely on the MCP client. `helio-mcp/src/types.ts`'s `RunResultResponse` does not declare
`truncatedReads`, so it is dropped at the type boundary; `helio-mcp/src/helioApi.ts:609-618` (`runPipeline`) maps only
`sourceTruncated`/`sourceAvailableRowCount`/`truncationNotice` into `RunOutcome`; and `helio-mcp/src/tools/write.ts`'s
`run_pipeline` description names `availableRowCount` without its scope. `guarded`/`jsonResult` stringify `RunOutcome`
verbatim, so `RunOutcome`'s field names ARE what an agent reads — the naming is the contract, not a detail.

Two concurrent runs on this machine are editing the ACL path, `schemas/`, `openspec/` specs, and dashboard/panel
frontend (HEL-590), plus possibly `PipelineStepRepository`. None of those are in this change's file set.

## Goals / Non-Goals

**Goals:**
- No two truncation numbers of different scope readable as a same-scope pair (AC1).
- `truncatedReads` reaches the MCP result, present-and-empty on a complete run (AC2).
- Coverage that fails when the secondary case regresses, asserting emitted structure field by field (AC3, AC5).
- `run_pipeline`'s description states each field's scope (AC4).

**Non-Goals:** backend wire renames; schema/migration changes; frontend; cap changes; notice wording.

## Decisions

**D1 — AC1 is resolved by renaming at the MCP surface, not by changing semantics.** The spec already decided the
split (scalars primary-scoped, flag run-wide). The bug is that `RunOutcome` expresses that split with names that hide
it. So: `availableRowCount` → `primaryAvailableRowCount`, `sourceRowCount` → `primarySourceRowCount`, `truncated`
stays run-wide (fail-safe: a run-wide false when a secondary was cut is the worse error), and its doc comment says so.
The rename does NOT remove the pair — `primaryAvailableRowCount`/`primarySourceRowCount` are still both present and
still both `100` in the field case. What it removes is the pair's *apparent run-wide scope*: an agent can no longer
read two unqualified numbers as a statement about the run. The thing that actually makes "nothing was lost"
unavailable is `truncated: true` alongside a non-empty `truncatedReads`; the rename's job is to stop the scalars from
contradicting that, not to be the signal itself.

*Alternative rejected:* make the scalars run-wide (e.g. `availableRowCount` = max/sum across sources). Sum is
meaningless across heterogeneous sources; max silently changes which source a number describes between runs. It would
also contradict the already-archived spec and the backend wire, forcing a backend change into a file set a concurrent
run is editing.

*Alternative rejected:* leave the names and rely on `truncatedReads` alone. The contradictory pair still sits in the
result; an agent that never looks past the scalars — the exact agent in the field report — is still misled.

**D2 — `truncatedReads` is required and defaulted to `[]`, not optional.** `RunOutcome.truncated` was already made
non-optional by HEL-861 for the same reason ("a truncated run is never indistinguishable from a missing field"); the
same argument applies to a per-source array. `runPipeline` maps `result.truncatedReads ?? []`.

**D3 — Backend change is limited to test coverage plus a scaladoc sharpening.** `truncationFields` is correct. AC3/AC5
are satisfied by a `PipelineRunServiceSpec` case with primary under cap and a `lookup`/`union` secondary over it,
asserting `sourceTruncated`, `sourceRowCount`, `sourceAvailableRowCount` and the full `truncatedReads` entry —
added ALONGSIDE the existing line-1513 case. That case is NOT as thin as this change first assumed: it already
asserts `sourceTruncated` and `truncatedReads.map(_.dataSourceName) should contain(...)`, and a sibling (~line 1537)
pins `truncatedReads` contents for three sources. The genuinely uncovered surface is the per-entry NUMERIC detail on a
secondary (`rowsRead`, `availableRowCount`) — that, and only that, is what the new backend assertion must isolate to.
No `DbContext` and no RLS dependence is introduced by these tests.

**D4 — Evidence.** Each new test must be shown to go red under a mutation that isolates to it. Both mutations below
were chosen *after* checking what pre-existing tests already observe and whether the mutation compiles.

- **(i) MCP axis — value-level, still compiles.** In `runPipeline`, map `truncatedReads: []` unconditionally instead of
  `result.truncatedReads ?? []`. A *type*-level mutation (deleting the field) is NOT usable: task 2.3 makes
  `truncatedReads` required and root `jest.config.cjs` runs `ts-jest` with diagnostics on, so deletion yields TS2741
  "Test suite failed to run" — a compile failure, not a red arm. The value-level form fails the deep-equal assertion in
  `runPipelineTruncation.test.ts` and nothing else.
- **(ii) Backend axis — per-entry numeric detail.** Emit `availableRowCount = None` on the secondary's `TruncatedRead`. Edit site: the `sink.reads` arm inside `truncationFields` — `primaryRead` is built separately, so the primary path is provably untouched; record the site in the transcript.
  No existing test observes a secondary entry's `availableRowCount`, so this reddens only the new assertion. The
  obvious alternative — making `truncationFields` return the primary read only — is REJECTED: it reddens the line-1513
  case and the line-1537 order-pinning case, i.e. it proves old coverage, exactly what the evidence standard bans.

These are two axes, not one: (i) exercises the client mapping with the backend held fixed, (ii) exercises the backend
payload with the client held fixed, and neither can mask the other. Expected values in the MCP test are literals in the
fixture, never re-derived from `RunOutcome`'s own mapping. For each mutation the executor records the mutation applied,
the exact failing assertion, and confirmation the failure is an assertion failure rather than a compile/lint failure.

## Planner Notes (self-approved)

- The `RunOutcome` rename is breaking for readers of the `run_pipeline` tool result. Self-approved: helio-mcp is a
  first-party server, the result shape has been changed before under the same reasoning (see `RunOutcome`'s own doc
  comment on the removed `outputDataTypeId`), and an agent is re-reading the tool description on every session. It is
  called out in the PR body.
- No Flyway migration is added or edited. This change touches no `backend/src/main/resources/db/migration/` file.

## Risks / Trade-offs

- **Rename churn.** Any in-repo caller of `RunOutcome.availableRowCount`/`sourceRowCount` must move; `tsc` catches
  every one, and the tool description must be updated in the same commit or it documents dead field names.
- **`truncatedReads` includes the primary when the primary is truncated**, so it is not "secondaries only". The tool
  description must say this, or an agent will read a one-entry array as necessarily a secondary.
