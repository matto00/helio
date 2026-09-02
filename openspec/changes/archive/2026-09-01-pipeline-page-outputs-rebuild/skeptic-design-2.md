## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived every claim from the merged backend in this worktree (cold, not from the round-1 report's prose).

Round-1 change requests — status:

1. **CR1 (single-call new-pipeline) — RESOLVED.** `PipelineProtocol.scala:36-42` confirms
   `CreatePipelineRequest(name, sourceDataSourceId, tag, steps, outputs)` — required source id, no
   inline-source arm. `specs/pipeline-new-flow/spec.md:20-35` now states create-source-then-one-`POST
   /api/pipelines` explicitly, with both scenarios (new source = 2 calls, existing = 1), and design.md
   decision 10 records the divergence from the binding spec's decision 4 with a follow-up note. Task 7.2
   matches. Verified the source-creation route it leans on actually exists and covers the paste-a-table
   arm: `DataSourceRoutes.scala:57,76-77` — `POST /api/data-sources` dispatches static / CSV-URL /
   multipart-upload.
2. **CR2 (outputs source) — RESOLVED.** `PipelineRoutes.scala` returns `PipelineSummaryResponse`, which
   (`PipelineProtocol.scala:44-54`) still has no `outputs`/`steps`. design.md decision 2 and task 2.1 now
   name `GET /api/pipelines/:id/outputs` (`OutputRoutes.scala:31-38`, optional `nodeStepId`) and make it
   the single source for the header/tab count.
3. **CR3 (`POST /api/outputs`) — PARTIALLY RESOLVED.** The Output half is fixed (see CR#1 below for the
   step half). Confirmed `OutputRoutes.scala:41` `POST /api/pipelines/:id/outputs`, and
   `OutputRoutes.scala:109-118` bare `outputs` is GET-only. `CreateOutputRequest`
   (`OutputProtocol.scala:31-36`) does carry `nodeStepId`, as decision 5 assumes. `GET/PATCH/DELETE
   /api/outputs/:id` all exist (`OutputRoutes.scala:58/63/70`), matching task 2.1.
4. **CR4 (`step.children`) — RESOLVED.** `PipelineStepProtocol.scala:20-43` confirms the flat
   `parentStepId: Option[String]` on every step subtype, no `children`. design.md decision 1 is rewritten
   in terms of a `buildStepTree(steps)` selector grouping the flat list by `parentStepId` + position-0
   trunk chain vs. position>=1 tails, and names where it lives (slice selector). Unambiguous.
5. **CR5 (placements data source) — RESOLVED.** `OutputRoutes.scala:75` `GET /api/outputs/:id/panels`
   confirmed. New design.md decision 9 names it, and specifies lazy-per-card in the gallery vs.
   fresh-on-open in the sheet (with the delete-warning staleness rationale). Tasks 4.2 and 5.7 match.

Round-1 non-blocking notes: task 1.2 now includes `rows` and `assertion-status`; task 9.3 now records the
interaction count against the spec-line-256 `<=12` budget. Both adopted.

New grounding checks this round (the same files I would check cold):

- `PipelineStepRoutes.scala:20-49` — step creation is `POST /api/pipelines/:id/steps`; the
  `pipeline-steps` prefix is `pipeline-steps/:id` ONLY (PATCH / DELETE / `:id/duplicate`).
  `grep -rn '"pipeline-steps"' backend/src/main/scala` returns exactly one hit, that prefix. Re-run to
  confirm; stable. `CreatePipelineStepRequest` (`PipelineStepProtocol.scala:167-173`) does carry
  `parentStepId`, so the tail-create itself is expressible — only the URL is wrong.
- `PipelineShapeRoutes.scala:32-38` + `PipelineShapeProtocol.scala:53` — `ExpandPipelineShapeRequest` is
  `(params: JsObject)` and nothing else; the route passes `req.params` alone to the service.
- `PipelineShapeProtocol.scala:65-80,87-89` — expand's `steps[]` `parentStepId` values are *synthetic
  intra-response `clientId`s* (`"step-0"`, ...), and the docstring states `outputs` is `None` for EVERY
  shape today ("no output-declaration concept yet ... forward-compatible wire shape").

### Verdict: REFUTE

### Change Requests

1. **`POST /api/pipeline-steps` does not exist — same defect class as round-1 CR3, in the same
   decision.** design.md decision 5 (line 61) and task 5.6 both specify the "add as tail with aggregate"
   sequence as `POST /api/pipeline-steps` then `POST /api/pipelines/:id/outputs`. Step creation is
   `POST /api/pipelines/:id/steps` (`PipelineStepRoutes.scala:21,28-33`); the `pipeline-steps` prefix is
   `:id`-scoped only (PATCH/DELETE/duplicate — `PipelineStepRoutes.scala:47`). Correct the endpoint in
   decision 5 and task 5.6, and state that the aggregate step is created with `parentStepId` = the chosen
   node (`CreatePipelineStepRequest.parentStepId`, `PipelineStepProtocol.scala:172`) so the tail actually
   parents correctly.

2. **The shape-expand delta requires sending `parentStepId` to an endpoint that has no such field, and
   misattributes the tail-parenting to the server.** `specs/pipeline-shape-instantiation-ui/spec.md:64-66`
   ("SHALL call `POST /api/pipeline-shapes/:id/expand` with the collected params and `parentStepId` set to
   the chosen step") is contradicted by `ExpandPipelineShapeRequest(params: JsObject)`
   (`PipelineShapeProtocol.scala:53`) and by the route, which forwards only `req.params`
   (`PipelineShapeRoutes.scala:35`) — the server never learns which step was chosen. Worse, the
   `parentStepId` values in the *response* are synthetic intra-response `clientId`s chaining each entry to
   the prior one (`PipelineShapeProtocol.scala:65-72,87-89`), not real step ids. Restate the requirement
   as what actually works: call expand with params only; then, client-side, create step 0 with
   `parentStepId` = the chosen step's real id and each subsequent step with `parentStepId` = the real id
   returned for the step whose `clientId` it referenced. Update design.md (no decision currently covers
   this mapping) and task 6.3, which today says only "seed steps as tail then Outputs".

3. **"Add Outputs from a shape" cannot add a single Output against the shipped backend, and the plan does
   not acknowledge it.** `ExpandPipelineShapeResponse.outputs` is documented as `None` for EVERY shape
   today (`PipelineShapeProtocol.scala:87-89`) — no `PipelineShape.expand` declares outputs. The delta's
   headline requirement is "Submitting the params form expands the shape and seeds steps and Outputs" and
   its primary scenario ("expands to `{steps: [...], outputs: [...]}`") can never be exercised against a
   real backend, only against a fabricated fixture — the exact evidence-shaped-non-evidence trap. Either
   (a) state explicitly in design.md and the delta that the outputs arm is dormant-but-implemented
   (absent-`outputs` is the only live path; the populated path is fixture-tested only, with a named
   follow-up ticket for a shape that declares Outputs), or (b) drop the outputs arm from this ticket's
   scope. Also specify the TS type of `outputs`: the wire type is an untyped `JsArray`
   (`PipelineShapeProtocol.scala:91`), so the delta must say what element shape the client parses and what
   it does with an element it cannot parse.

### Non-blocking notes

- Task 6.3 says "seed steps as tail" but the delta's `#### Scenario: Empty pipeline shows the shape-picker
  affordance` scopes the picker to "the pipeline's root" when there are zero steps. With no steps, there is
  no parent step id to attach to — worth one sentence saying the zero-step case creates a trunk chain
  (`parentStepId` absent) rather than a tail.
- design.md decision 8's `key={chartType}` remount is asserted as the fix for HEL-629 without a
  probe-confirmed root cause ("which is what crashes today" is a claim, not evidence). Per
  `systematic-debugging.md` the executor will owe a probe before the fix; flagging now so it is not
  discovered at the final gate.
