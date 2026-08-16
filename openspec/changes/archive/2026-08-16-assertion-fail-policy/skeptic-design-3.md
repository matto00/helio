## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Rounds 1-2's fixes remain sound (re-read independently, not trusted from the prior reports):**
- Read all six spec delta files in `openspec/changes/assertion-fail-policy/specs/` end-to-end
  (`pipeline-assert-fail-policy` ADDED; `pipeline-run-execution`, `pipeline-run-sse`,
  `alert-evaluation-engine`, `datatype-row-snapshot`, `pipeline-list-api` MODIFIED). Each `MODIFIED
  Requirements` block is a complete, non-lossy copy of the corresponding canonical
  `openspec/specs/<capability>/spec.md` requirement with the blocked-run carve-out added and a new
  scenario appended — confirmed by diffing requirement/scenario counts against the canonical specs
  myself (e.g. `pipeline-run-execution` canonical has the same 3 requirements/pre-existing scenario
  set the delta preserves; `pipeline-list-api` canonical's "Backend pipelines table exists" scenario
  count matches). No regression from round 2.
- Re-read `proposal.md`'s "Modified Capabilities" (now lists all five) and `design.md`'s Decision 7
  (accurately narrates the two-round history). Consistent with the actual delta files on disk.

**My own independent, exhaustive search for the same "unconditional success ⇒ writes/sets X" pattern
across every capability, not just re-checking the five already fixed:**
- Enumerated all 274 capabilities under `openspec/specs/`, grepped for
  `pipeline.?run|onRunSuccess|overwriteRows|data_type_rows|last_run_status|pipeline_runs|
  dataTypeRowRepo|binaryRef|evaluateForDataType|output_data_type` (case-insensitive), and read every
  one of the ~30 hits in full: `alert-event-persistence`, `alert-event-state-machine`,
  `bound-panel-composition`, `datatype-crud-api`, `data-type-persistence`, `dev-db-repair`,
  `echarts-chart-panel`, `external-run-hooks`, `image-file-connector`, `panel-batch-create`,
  `panel-data-freshness`, `panel-datatype-binding`, `pdf-connector`, `pipeline-assert-evaluation`,
  `pipeline-dry-run-ui`, `pipeline-last-run-row-count`, `pipeline-list-api`,
  `pipeline-proposal-apply`, `pipeline-run-execution`, `pipeline-run-provenance`,
  `pipeline-run-sse`, `pipeline-run-status-ui`, `pipeline-schedule-persistence`,
  `pipeline-scheduler-runtime`, `rls-owner-tables`, `rls-policy-guard`, `rls-privileged-bypass`,
  `rls-privileged-dml-coverage`, `schema-inference`, `text-file-connector`,
  `type-registry-content-fields`, `workspace-context-assembly`.
- Confirmed round 2's non-blocking note is still correct: `image-file-connector`'s binary-ref
  requirement and `type-registry-content-fields`'s `overwriteForDataType` requirement are both
  conditionally phrased ("whenever it writes ... via `overwriteRows`, also ...") and hold vacuously
  for a blocked run — no delta needed. `pipeline-last-run-row-count`'s "failed non-dry run" scenario
  (`rowCount = NULL`) already matches the blocked path's `rowCount = None` convention (design.md
  Decision 3) even though its WHEN-clause wording ("fails during step execution") doesn't literally
  describe a block — the invariant it actually asserts (`status = "failed" ⇒ row_count NULL`) still
  holds, so this is not a contradiction. `panel-data-freshness`/`panel-datatype-binding`'s `dataAsOf`
  requirements are correctly conditioned on `last_run_status = 'succeeded'` already, so a blocked run
  (which sets `"failed"`) is correctly excluded — not a contradiction, in fact this is the design
  working as intended. RLS specs only enumerate table names, unaffected.

**The gap that remains: two composed, multi-stage services treat `PipelineRunService.submit`'s
`Right` as unconditional proof the DataType was written — this design never touches them.**
- `backend/src/main/scala/com/helio/services/BoundPanelService.scala:204-221` (`runPipeline`) and
  `backend/src/main/scala/com/helio/services/PipelineProposalService.scala:324-337`
  (`createPipeline`'s run stage) both call `pipelineRunService.submit(pipelineId, isDry = false,
  user)` and branch **only** on `Left` (triggers their existing compensating-cleanup/rollback) vs.
  `Right` (proceeds to create/bind the panel, or returns `201` success). `BoundPanelService.scala`'s
  own doc comment states the premise explicitly: "design.md D6: a zero-row `Right(...)` is success,
  not failure — only a `Left` (engine exception, unsupported source type, etc.) triggers cleanup."
- Confirmed via `RunResultResponse` (`backend/src/main/scala/com/helio/api/protocols/
  PipelineProtocol.scala:57-63`) — the type returned inside that `Right` — that it carries only
  `rows`, `rowCount`, `stepRowCounts`, `sourceRowCount`, `runId`. **No `status`/`errorLog` field.**
  Per this design's own already-verified claim (round 2: "`response` is constructed from
  `resultRows`/`jsRows` *before* `onRunSuccess` is invoked, and `followUp.map(_ => Right(response))`
  returns that fixed value regardless of what `onRunSuccess` does internally"), `submit` will return
  `Right(RunResultResponse(rows=<computed-but-rejected-rows>, rowCount=N, ...))` for a **blocked**
  run exactly as it does for a genuinely successful one — the two are indistinguishable to a caller
  of `submit` without a separate lookup of `pipeline_runs`/`errorLog` that neither composed service
  performs.
- Confirmed `assert` is a fully registered, unrestricted step kind
  (`backend/src/main/scala/com/helio/domain/PipelineStep.scala:171,176`,
  `PipelineStepKind.Assert = AssertStep.Kind`, part of the registry-derived `All` set with no
  allow/deny-list carve-out anywhere in `BoundPanelService.addSteps` or
  `PipelineProposalService.addSteps`) — so a caller (a human, or — per `mcp-pipeline-proposal-tools`/
  the agent-authored-pipelines work referenced in `openspec/specs/pipeline-proposal-apply/spec.md`
  and `openspec/specs/combined-proposal-apply/spec.md` — an **agent**) can legally include a failing
  `assert` step in `POST /api/panels/bound`'s or `POST /api/pipelines/apply-proposal`'s
  `pipeline.steps`, reaching this exact path.
- **Concrete consequence:** `POST /api/panels/bound` with a pipeline whose `assert` step fails at
  `error` severity will, under this design, still create the panel and bind it to `outputDataTypeId`,
  return `201`, and report a nonzero `rowCount` in the embedded run result — while the DataType's
  actual `data_type_rows`/schema were **never written** (the ticket's own blocking behavior skipped
  them). This directly contradicts `bound-panel-composition`'s own existing, unconditional scenario
  ("Inline source, happy path" — "`GET /api/types/:dataTypeId/rows` returns the pipeline's output
  rows immediately (no separate run call needed)") for a reachable input this design creates. The
  identical gap propagates through `PipelineProposalService.apply` (`POST
  /api/pipelines/apply-proposal`, no rollback triggered for a blocked run since it never returns
  `Left`) and transitively through `combined-proposal-apply` (`POST /api/proposals/apply`, which
  "compos[es] only the existing `PipelineProposalService`... unchanged" per its own spec) — a full
  agent-authored dashboard-build call can "succeed" with `201` while silently binding panels to an
  empty/stale DataType, with **no** field in either response signaling why.
- Searched `design.md`/`proposal.md`/`ticket.md`/`tasks.md` for any mention of `BoundPanelService`,
  `PipelineProposalService`, or `combined`/`compose` — none exists. This interaction was not
  considered at all, not merely deferred with a stated rationale.

This is the same fundamental pattern round 1 and round 2 both found and fixed ("unconditional
success ⇒ downstream effect X"), just manifesting as a **live code path a caller can trigger today**
rather than as spec prose — which makes it more consequential than the five already-fixed
documentation deltas: it means the ticket's own stated purpose ("bad data never reaches bound
panels/metrics... This is what makes an 'alive' agentic dashboard trustworthy," ticket.md line 5) is
violated by a reachable path this design leaves untouched.

### Verdict: REFUTE

### Change Requests

1. **`design.md` must explicitly address the `BoundPanelService`/`PipelineProposalService` (and
   transitively `combined-proposal-apply`) composed-endpoint interaction before implementation
   begins.** These two services call `pipelineRunService.submit` and treat its `Right` result as
   proof the DataType was written, with no visibility into the new blocked/not-blocked distinction.
   Pick one and record it as a numbered Decision:
   - **(Preferred)** Extend scope: after `submit` resolves with `Right`, both services check whether
     the run was blocked (e.g. via the `runId` it already receives — look up the persisted
     `pipeline_runs.status`/`errorLog`, or have `PipelineRunService` surface the block outcome
     directly rather than only via side-channel persistence) and, if blocked, treat it the same way
     `runPipeline`/`createPipeline` already treat a `Left` — trigger existing compensating
     cleanup/rollback and return a stage-tagged error (`"run"`) instead of proceeding to
     `createPanel`/returning `201`. This keeps the ticket's own trust guarantee ("bad data never
     reaches bound panels") intact for these paths too, and needs no new API surface — both services
     already have a cleanup/rollback code path for exactly this "run" stage.
   - **(Acceptable alternative)** Explicitly declare this out of scope with a stated rationale, file
     a spinoff ticket, and add `MODIFIED Requirements` deltas to `bound-panel-composition` (and
     `pipeline-proposal-apply`/`combined-proposal-apply` if they make the same claim) carving out the
     exception — e.g. amending "Inline source, happy path"'s scenario to note that a pipeline
     containing a blocking `assert` step still returns `201` but leaves `GET
     /api/types/:dataTypeId/rows` unpopulated. Silence (today's state) is not acceptable either way,
     because it leaves the ticket's own stated goal violated through a reachable, already-supported
     path (`assert` is an ordinary, unrestricted step kind acceptable in both endpoints'
     `pipeline.steps`) with no design-level decision on record.
   Either option is implementable within a reasonable extension of this change's scope; what's not
   acceptable is proceeding to implementation with this interaction unaddressed, since it directly
   undermines the ticket's own acceptance criteria in a way a future reader would have no reason to
   suspect from `design.md` alone.

### Non-blocking notes

- The five already-fixed `MODIFIED Requirements` deltas (`pipeline-run-execution`,
  `pipeline-run-sse`, `alert-evaluation-engine`, `datatype-row-snapshot`, `pipeline-list-api`) and
  the new `pipeline-assert-fail-policy` ADDED delta remain well-formed and internally consistent;
  no changes needed to any of them from this round's search.
- If Change Request #1 is resolved via the "extend scope" option, `tasks.md` will need two new items
  under a section covering `BoundPanelService`/`PipelineProposalService`, plus corresponding test
  coverage (a `POST /api/panels/bound` / `POST /api/pipelines/apply-proposal` request whose
  `pipeline.steps` includes a failing error-severity `assert` step) — flagging this now so the next
  round's tasks.md update isn't a surprise scope increase.
