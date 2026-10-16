## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD db91c840ea729c1b3f662ae1eb01643ac1739e2d (change dir untracked). Owner ruling B
(`escalation.answered` B-identical-plus-backend-batch, events.jsonl line 7) is not re-opened.

### What I verified (with evidence)

- **Request arithmetic holds.** context.ts:524-529 (4 core), buildAgentContext (2), buildConnectors (1),
  fetchAllOutputs (1 page at limit 200), per pipeline analyze + run-history + getPipeline, and getPipeline is 2 GETs
  (helioApi.ts:310-316). Today: 8 + 4x55 + 110 + 1 = 339, which matches the measured figure. After the change:
  8 + 1 (batch) + 55 (analyze) + 19 (placed /panels) + 1 (snapshot) = 84, which is under 120. Target reached on the
  stated fixture. Break-even is about P=100, and the design states this.
- **panelCount semantics are sound.** `GET /api/outputs` sets `panelCount` from `countByOutputIdsInternal`
  (OutputRoutes.scala:217-221, default 0). `/outputs/:id/panels` uses `findByOutputIdInternal`. Both run in system
  context with the same `panels.output_id` predicate (PanelRepository.scala:189-209). `=== 0` ⇔ `[]` for the same
  snapshot. Skipping only on `=== 0` (absent → call) is correct.
- **Route ordering is correct as specified.** `PipelineIdSegment = Segment.map(PipelineId(_))` is unconstrained
  (IdParsing.scala:18). In PipelineRoutes, `path(PipelineIdSegment)` GET would swallow `context-details`, and
  PipelineRoutes is the first `pipelines` router in ApiRoutes (line 946). The run/step routers come later
  (947, 965-975). So the new path MUST live in PipelineRoutes before `path(PipelineIdSegment)`, which is what D1 says.
- **Steps parity source traced.** `/steps` = `PipelineService.listSteps`, which runs `findByIdShared`, then
  `listByPipelineInternal` + `rootIdsOf`, then `PipelineStepResponse.fromDomain(s, rootIdMap)`
  (PipelineService.scala:208-229). The batch siblings `listByPipelineInternalBatch` (executionOrder per pipeline)
  and `rootIdsOfBatch` exist with the same filters (PipelineStepRepository.scala:361-370, 1146-1159). D3's instruction
  is right.
- **Latest-run parity source traced.** `history` = `listByPipelineInternal` (`startedAt desc`, any status, dry
  included; PipelineRunRepository.scala:543-549), then per run `listAssertionsByRunInternal` + `summarizeAssertions`
  (PipelineRunQueries.scala:90-115, 180-188). D4 matches. The MCP mapping `?? ZERO_ASSERTION_SUMMARY` matches
  context.ts:582.
- **RLS scoping is sound.** `listSummaries` filters `ownerId === user` under `withUserContext`
  (PipelineRepository.scala:656-676). Feeding only those ids to system-context batch reads follows the existing
  HEL-914 pattern. `TwoUserRlsApiFixture` exists (backend/src/test/.../testsupport).
- **Pool deadlock risk is identified.** contextControls.ts `load` dedupes a snapshot promise that is awaited inside
  each placements task. D8 names the hazard, gives two valid remedies and requires a test (task 2.2).
- **Byte-identical strategy is sound.** D9's golden is captured from main's code, and the three paths are tested
  against it.

### Verdict: REFUTE

### Change Requests

1. **The spec and tasks contradict ground truth on grant-shared pipelines.** specs/pipeline-context-details-read/spec.md,
   scenario "Items match the caller's pipeline list", expects three items for "two owned + a viewer grant on a third".
   tasks.md 4.1 says "(owned + grant-shared)". But `GET /api/pipelines` is owner-only
   (`PipelineRepository.listSummaries` filters `p.ownerId === ownerUuid`, lines 659-660). The normative requirement
   ("exactly the ids `GET /api/pipelines` returns") is correct. The scenario is not: a test written to it either fails
   or pushes the executor to widen `listSummaries`, which would change an existing response and violate C2.
   Fix: rewrite the scenario so a viewer-granted pipeline is **absent** from the response (as it is from
   `GET /api/pipelines`), and change 4.1 to "owned only; a grant-shared pipeline is excluded".
2. **Decide which service owns the composed read.** D1 requires the route in `PipelineRoutes`, which today receives
   only `pipelineService`. `PipelineService` has no `PipelineRunRepository` (constructor, PipelineService.scala:37-66).
   The run reads and `summarizeAssertions` (private, inside `private[pipelines] PipelineRunQueries`) live under
   `PipelineRunService`. "PipelineService / run-query batch reads" (proposal Impact, tasks 1.2/1.3) can reasonably be
   read two ways:
   - (a) add a run repo to `PipelineService`'s constructor, which ripples into every fixture that builds it;
   - (b) pass `PipelineRunService` (or a narrow reader) into `PipelineRoutes`.

   Record the choice in design.md. Whichever it is, the route must stay registered before `path(PipelineIdSegment)`
   in PipelineRoutes. Also state that `summarizeAssertions` is reused by widening its visibility, not copied. And
   state what happens when the run repo is null: `history` returns `Right(Vector.empty)` in that case
   (PipelineRunQueries.scala:91), so the parity rule is to omit `latestRunAssertions`.

### Non-blocking notes

- **Tie-break determinism.** Three orderings are not fully specified today:
  - `childrenOf` sorts stably by `position` (PipelineStepRepository.scala:1119), so same-position siblings (e.g.
    two roots' first steps) keep DB row order.
  - `listAssertionsByRunInternal` has no ORDER BY, so `failures[]` order is DB row order.
  - A "latest run per pipeline" query (e.g. DISTINCT ON) breaks `startedAt` ties arbitrarily.

  Single-id and `IN (...)` reads both return heap order in practice, but the 4.2 parity test should cover a
  multi-root pipeline and a run with at least two failures, so a divergence shows up red rather than flaky.
- There is no existing step-response schema under `schemas/pipelines/` to `$ref`, so D5's "reuse where `$ref`
  allows" will mean inlining. That is fine, but the inlined schema must match `PipelineStepResponse`'s
  serializer, including the optional `rootId`/`parentStepId`.
- The backend must emit an item (with `steps: []`) for a pipeline that has zero steps. `groupBy` in
  `listByPipelineInternalBatch` produces no key for such a pipeline, so default to empty rather than dropping the
  item. Dropping it would silently push the MCP into the per-pipeline fallback.
