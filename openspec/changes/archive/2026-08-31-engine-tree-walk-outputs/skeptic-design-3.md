## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold re-derivation from the worktree's own files. I re-read the revised `design.md`, `tasks.md` and all
six spec deltas, and re-checked every code citation myself rather than trusting the round-2 report.

**Round 2 CR1 — Decision 6's false frontend claim.** Ground truth re-confirmed:
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts:3` — `export type SseRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "dry_run";` still a closed union; `RunEventsState`
  (`:11-16`) still `{ status, rowCount, errorLog, connectionError }`.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx:167-186` — `displayStatus = sseData.status
  ?? runStatus`, five literal equality branches, `displayRowCount = sseData.rowCount !== null ? ...`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:749-752` — the same `sseData?.rowCount`
  preference feeding `PipelinePreviewModal`'s `rowCount`.
Decision 6 now states the correction explicitly (widen `SseRunStatus`; add `nodeId`/`nodeRowCount`;
`node-progress` must update ONLY those, never `status`/`rowCount`), which is the smallest change that
leaves both files above untouched and correct. Tasks 6.5, 7a.1 and 6.6 (a test asserting the footer's
status/row count do NOT change on `node-progress`) carry it, and task 10.7 is corrected from "N/A" to a
real UI gate. **Addressed.**

**Round 2 CR2 — unmodified dry-run requirement contradicting the delta.** `openspec/specs/pipeline-run-execution/spec.md:69-82`
still says "SHALL NOT write results to the Type Registry" / "the Output's `fields` and `version` are
unchanged". The delta now carries a MODIFIED block for that exact requirement restating it as "SHALL NOT
write to `node_snapshots` or any Output's `schema`", with the scenario reworded and both original
scenarios preserved (2 -> 2). The `version`-does-not-exist contradiction is gone. **Addressed.**

**Round 2 CR3 — dry-run wire-contract ambiguity.** Decision 5 now states option (a) explicitly: engine
return value only (`nodeOutcomes`), `POST /api/pipelines/:id/run?dry=true`'s `{ rows, rowCount }` shape
untouched, HTTP exposure named as P1.3/HEL-906's job with its own `schemas/`+OpenAPI delta. The MODIFIED
dry-run requirement repeats the same scoping in spec language. No `schemas/` delta is owed by this
ticket under that reading. **Addressed.**

**Round 2 CR4 — second `.filter(_.enabled)` call site.** Re-confirmed in
`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`: `:242`
`allSteps.filter(_.enabled)` and, independently, `:281` `sortedSteps.take(k + 1).filter(_.enabled)`
inside `previewStep` (the separate `case k if !sortedSteps(k).enabled` disabled-target guard is at
`:276`). Decision 7's round-2 addendum, task 3.1a, task 5.4 ("do not pre-filter that path by `enabled`")
and task 5.6 (new test: previewing a step whose *ancestor chain* contains a disabled step, explicitly
distinguished from task 3.5's disabled-target case) all now cover it, and correctly leave the `:276`
guard alone. **Addressed.**

**No regression of round 1's seven fixed items / no dropped scenarios.**
- `npx openspec validate engine-tree-walk-outputs --strict` -> `Change 'engine-tree-walk-outputs' is valid`.
- Scenario preservation re-counted requirement-by-requirement against `openspec/specs/` (using the real
  requirement boundaries, not a naive range — `Select step retains only specified columns` sits between
  the schema-snapshot and partial-execution requirements and is untouched): run req 7 -> 8, dry-run
  2 -> 2, schema-snapshot 5 -> 5, partial-execution 1 -> 3; `pipeline-run-sse` 6 -> 9 total in-file,
  no pre-existing scenario dropped from the MODIFIED enumeration requirement; `pipeline-aggregate-op`,
  `pipeline-analyze-api`, `pipeline-execution` unchanged from the round-2 shape.
- The new `specs/pipeline-run-status-ui/spec.md` is ADDED-only and its requirement name does not collide
  with the three existing ones in `openspec/specs/pipeline-run-status-ui/spec.md` (`:6`, `:37`, `:58`).
- `PipelineRunService:242`, `previewStep`, `AggregateStep`, `PipelineStepRepository.childrenOf/executionOrder`,
  `PipelineRunRegistry.TerminalStatuses`, `V84__pipeline_run_assertions.sql` step_id — all still as the
  design describes; no decision drifted while Decisions 5/6/7 were rewritten.

### Verdict: CONFIRM

All four remaining change requests are genuinely addressed against ground truth, not paraphrased away.
The design is unambiguous enough to implement: the engine/HTTP boundary is stated, both disabled-step
call sites are owned by named tasks, the frontend surface is named with the exact minimal edit and a
guarding test, and the spec deltas no longer leave a contradicting live requirement on the dry-run path.

### Non-blocking notes

- Two residual "additive enumeration" soft spots of the same family as CR2, but neither is a logical
  contradiction and neither can mislead an implementer given the explicit tasks:
  (a) `openspec/specs/pipeline-run-status-ui/spec.md:8-10` still says the hook "SHALL parse each
  `run-status` event's JSON data and return `{ status, rowCount, errorLog }`" — the new ADDED requirement
  carves `node-progress` out by specificity rather than by a MODIFIED block. If a MODIFIED delta is cheap
  at execution time, folding the carve-out into that requirement would leave a cleaner archived spec.
  (b) `openspec/specs/pipeline-run-execution/spec.md:207-209` enumerates published events as
  `queued`/`running`/`succeeded`/`failed`; that is a "SHALL publish at these transitions" statement, not
  an exhaustive prohibition, so `node-progress` does not contradict it.
- Decision 5 cites `previewStep` at `PipelineRunService.scala:281` while Decision 7 / task 3.1a cite
  `:279`; the actual `.filter(_.enabled)` is at `:281` (the `case k =>` opens at `:279`). Same code block,
  harmless, but worth not re-litigating mid-edit.
- Round 2's three non-blocking notes (trait default-argument restatement, "tail root and its descendant
  chain" wording in Decision 2 step 4) were not incorporated; still non-blocking.
