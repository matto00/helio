## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD db91c840ea729c1b3f662ae1eb01643ac1739e2d. The change dir is untracked. The owner ruling is verified in
`.concertino/runs/HEL-1619/events.jsonl`: line 7 is `escalation.answered`, answer `B-identical-plus-backend-batch`,
answer_source `human`. It is not reopened here.

### Round-1 change requests: both fixed
1. **Grant-shared pipelines.** The spec scenario now expects two items, with the viewer-granted pipeline absent.
   Task 4.1 now says "owner-scoped; a viewer-granted pipeline is absent". Both match ground truth:
   - `PipelineRepository.listSummaries` (lines 655-660) filters on `ownerId === ownerUuid` only.
   - The MCP iterates only `listPipelines` (helioApi.ts:305-307, `GET /api/pipelines`), so the owner scope loses nothing.
2. **Which service owns the read, and the null run repo.** D1 now settles both:
   - A new `PipelineContextDetailsRoutes(pipelineService, pipelineRunService, user)` is mounted before
     `PipelineRoutes`. Verified:
     - `new PipelineRoutes` is at ApiRoutes.scala:946.
     - No router mounted earlier claims a `pipelines` prefix. The earlier routers are DataSource/Source/Connector/Shape
       (top-level `pipeline-shapes`) and StepCatalog (top-level `pipeline-step-catalog`).
     - `pipelineRunService` is a public val (ApiRoutes.scala:449) and is always constructed.
     - So neither existing constructor changes.
   - The null run repo rule (omit `latestRunAssertions`) matches `PipelineRunQueries.history`, which returns
     `Right(Vector.empty)` when the repo is null (PipelineRunQueries.scala:90-91).

### What else I verified (fresh, against code)
- **Steps parity source.** `listSteps` = `findByIdShared` → `listByPipelineInternal` + `rootIdsOf` →
  `PipelineStepResponse.fromDomain` (PipelineService.scala:208-229). The batch siblings at
  PipelineStepRepository.scala:361-370 and 1146-1158 use the same filters and the same `executionOrder`. The
  `private[services]` delegates at PipelineService.scala:171-179 exist.
- **The MCP's `laneTree` reads only `/steps`.** `getPipeline` is `/:id` + `/:id/steps` (helioApi.ts:310-316), and
  context.ts:592 destructures only `steps`. So using batch steps, or the steps-only fallback, is payload-neutral.
- **The `lastRunAssertions` mapping is identical.** context.ts:579-586 computes
  `history[0]?.assertions ?? ZERO_ASSERTION_SUMMARY`, and it degrades to ZERO on error. D6 maps the batch value the
  same way.
- **The `panelCount` skip is sound.** The `GET /api/outputs` list always sets `panelCount`, as
  `Some(counts.getOrElse(id, 0))` (OutputRoutes.scala:217-221). `fetchPlacements` returns `[]` for an empty list
  (context.ts:188-205), so skipping on `=== 0` cannot change the payload.
- **Scoped PATs.** `confineScopedToken` returns 403 for any non-`hooks` path (AuthDirectives.scala:141-162). The new
  route gets exactly the same treatment as `GET /api/pipelines`, so nothing leaks.
- **Arithmetic.** The baseline probe (`.concertino/scratch/HEL-1619/baseline-request-count.md`, measure.mts) gives 339
  requests: 55 each for `/:id`, `/steps`, `/run-history` and `/analyze`, 110 for `/outputs/:id/panels`, plus 9 others.
  In the fixture all 19 placed Outputs map to `d-0`, so they share one dashboard. The target is 8 + 1 + 55 + 19 + 1 = 84.
- **The fallback on any failure is self-caught.** It is kept outside the fail-fast `Promise.all`. This is consistent
  with the HEL-1617 pattern at context.ts:504-521.

### Verdict: REFUTE

### Change Requests
1. **Close the client/server seam for the new read. As planned, a wire mismatch is invisible to every gate.**
   - **The problem.** By design (D6), a pipeline missing from `items`, or any decode failure, silently falls back to
     per-pipeline reads. Every MCP test in 3.1-3.3 runs against a fake backend whose `context-details` body the
     executor writes. Every backend test in 4.x checks the backend in isolation. Nothing proves that the body the MCP
     parses is the body the backend sends.
   - **What can go wrong.** If the two disagree on a key name (`pipelineId` vs `id`), on how `latestRunAssertions` is
     nested, or on the envelope (`items` vs a bare array), every test stays green:
     - the payload is still byte-identical, because the fallback is exact;
     - the fake-backend count test still shows 84;
     - but in production every pipeline falls back, and the call still sends about 284 requests.

     That defeats the ticket's first AC, and nothing goes red. This is the HEL-1208 → HEL-1220 class of defect.
   - **Required.** Add a task, and a scenario under `mcp-workspace-context-request-budget`, that ties the MCP's fixture
     to the backend's real wire shape. Either option is acceptable:
     - (a) An MCP-side test that validates the fake `context-details` body used in 3.1/3.2 against the committed
       `schemas/pipelines/pipeline-context-details-response.schema.json`. The schema must use
       `additionalProperties: false` on the item, so a misspelled key fails. Task 4.1/1.5 must also validate the
       backend route's real response against the same schema, following the existing pattern, e.g.
       `PipelineAnalyzeRoutesSpec`.
     - (b) A live probe: run `buildWorkspaceContext` through the real `HelioHttpClient` against a running worktree
       backend with at least 2 pipelines (one with runs and failed assertions). Record per-route counts, and show zero
       `/api/pipelines/:id/steps` and zero `/run-history` requests. Paste the output into the evaluation evidence.

     Whichever is chosen, show it red once: mutate one key name on one side and show the check fail.

### Non-blocking notes
- `HelioApi.listPipelineSteps(id)` already exists at helioApi.ts:853-856. D6 and task 2.1 say "new"/"Add". Reuse it,
  because adding a second member with the same name will not compile.
- D1 says to widen `summarizeAssertions` to package-private, but also says `latestAssertionsFor` is implemented
  inside `PipelineRunQueries`. If it lives in that class, no widening is needed. Either is fine, as long as it is not
  copied.
- The last sentence of D4, "Schema must NOT list it as required.", has a dangling "it". From context it means
  `latestRunAssertions`, and the spec agrees. Fix the wording when convenient.
- D4 vs D5: D4 says to inline the step shape, because no step schema exists. D5 says "reusing the existing step …
  definitions". Only the assertion summary has a `$ref` candidate: `pipeline-run-record.schema.json`.
- `listAssertionsByRunInternal` has no ORDER BY, so a batched `run_id IN (...)` fetch can return `failures[]` in a
  different order from the per-run fetch. Adding an ORDER BY to the existing read would change an existing response
  (C2). So the parity test in 4.2 is the only guard. Make sure it runs on a multi-failure run, which the spec scenario
  already requires.
- `PipelineRunService.latestAssertionsFor(ids)` takes ids it does not check. Give it a name or doc comment that marks
  it as caller-must-confirm-access, matching the `*Internal` convention, so nobody reuses it on an unvetted id set.
