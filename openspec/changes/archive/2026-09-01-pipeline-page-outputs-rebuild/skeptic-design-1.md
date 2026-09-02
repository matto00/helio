## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read ticket.md, proposal.md, design.md, tasks.md and all 8 spec deltas under
  `openspec/changes/pipeline-page-outputs-rebuild/specs/`.
- Read the binding spec `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`
  lines 32-44 (decisions 3/4/7/14), 88 (trunk/tail invariant + `parent_step_id`), 133-134
  (single-call `POST /api/pipelines`), 148-160 (Pipeline page UX), 223 (P1.5 row), 256
  (E2E interaction budget).
- Cross-checked every route/shape the plan leans on against the merged backend in this worktree:
  - `backend/.../api/routes/pipelines/PipelineRoutes.scala:59` — `GET /api/pipelines/:id/capabilities?stepId=` exists (optional param). OK.
  - `backend/.../api/routes/pipelines/PipelineRunStatusRoutes.scala:53-56` — `POST /api/pipelines/:id/preview?outputId=` exists, optional query param, single envelope. OK, matches tasks 5.5.
  - `backend/.../api/routes/pipelines/OutputRoutes.scala:31-118` — Output CRUD is under
    `pipelines/:id/outputs` (POST at line 42, GET with `nodeStepId` filter at 35);
    `GET /api/outputs/:id/panels` (line 75), `assertion-status` (80), `rows` (88), lean
    `GET /api/outputs` (109).
  - `backend/.../api/routes/pipelines/PipelineRoutes.scala:77-81` — `GET /api/pipelines/:id`
    returns `PipelineSummaryResponse`; `PipelineProtocol.scala:44-54` shows that case class has
    **no** `outputs` and no `steps`.
  - `PipelineProtocol.scala:36-42` + `schemas/pipelines/create-pipeline-request.schema.json` —
    `CreatePipelineRequest` **requires** `sourceDataSourceId`; `steps`/`outputs` are the only
    transactional additions. No inline-source arm.
  - `PipelineStepProtocol.scala:27-43` — steps expose a flat `parentStepId: Option[String]`;
    there is no nested `children` array on the wire.
  - `PipelineShapeProtocol.scala:57-78` — `expand` `{steps, outputs?}` with `clientId`/`parentStepId`. OK.

The plan is structurally coherent and its AC-to-task coverage is good (every ticket AC maps to
tasks in sections 3-10, the absorbed tickets 676/878/681/629/682/731/723 each have a named task,
and the HEL-934/HEL-936 shares are enumerated in 1.3). What it is not is *grounded*: four
load-bearing statements about the already-shipped backend are wrong, and one of them makes a
spec-delta requirement unimplementable as written.

### Verdict: REFUTE

### Change Requests

1. **`pipeline-new-flow/spec.md` asserts an API behavior that does not exist.** The delta's
   "Single-call creation" requirement and its scenario ("exactly one `POST /api/pipelines` call
   creates both the source and the pipeline") are contradicted by the shipped contract:
   `CreatePipelineRequest` (`PipelineProtocol.scala:36-42`,
   `schemas/pipelines/create-pipeline-request.schema.json` `"required": ["name","sourceDataSourceId"]`)
   requires a pre-existing source id and has no inline-source arm. The binding spec line 133 does
   describe `sourceId` **or** an inline source spec, so this is a gap between the spec and what
   P1.3 actually shipped — not something P1.5 can paper over. Revise the delta and task 7.2 to
   state the mechanism that actually works within this ticket's "no backend changes" non-goal
   (create the source first via the existing source-creation route, then one `POST /api/pipelines`
   carrying `sourceDataSourceId` + `steps` + `outputs`), and record the spec-vs-shipped divergence
   as an explicit note (with a follow-up ticket reference for the inline-source arm) rather than
   silently redefining "single-call".

2. **design.md decision 2 is factually wrong about where Outputs come from.** It says the rail
   reads `outputs[]` "already returned by the pipeline detail fetch per P1.3". `GET /api/pipelines/:id`
   returns `PipelineSummaryResponse`, which carries no outputs (`PipelineRoutes.scala:80`,
   `PipelineProtocol.scala:44-54`). Outputs must be fetched from `GET /api/pipelines/:id/outputs`
   (`OutputRoutes.scala:31-38`, optional `nodeStepId` filter). Correct decision 2 and task 2.1 to
   name the real endpoint, and state where the "Outputs (N)" header/tab count is sourced from
   (same list) — `pipeline-editor-page` and `pipeline-outputs-gallery` deltas both depend on it.

3. **design.md decision 5 names a nonexistent endpoint.** "add as tail with aggregate" is
   described as `POST /api/pipeline-steps` then `POST /api/outputs`. Output creation is
   `POST /api/pipelines/:id/outputs` (`OutputRoutes.scala:31,42`); there is no top-level
   `POST /api/outputs` (the bare `outputs` path is GET-only, line 109-118). Fix the call sequence
   in decision 5 and task 5.6.

4. **design.md decision 1 describes a wire shape that does not exist, and contradicts itself.**
   It has `TailChain` "read off `step.children` (position >= 1)"; steps carry a flat
   `parentStepId` (`PipelineStepProtocol.scala:27-43`), not `children`. It also states the
   invariant as "at most one position-0 child per node; tail nodes have no position >= 1 children"
   while simultaneously describing the trunk as the mapped step list — leaving the derivation rule
   ambiguous for an implementer. Restate decision 1 in terms of the actual data: how the client
   groups the flat step list by `parentStepId` + `position` into trunk (position-0 chain from the
   root) vs. tails (a child reached through a position >= 1 edge and its descendants, per spec
   line 88), and where that grouping lives (selector vs. component).

5. **Placements have no named data source.** `pipeline-outputs-gallery` ("on N dashboards") and
   `pipeline-output-sheet` ("list every dashboard placement with a link", "warn with the placement
   count") are required behaviors, but neither design.md nor tasks 4.2/5.7 says where placement
   data comes from. `GET /api/outputs/:id/panels` exists (`OutputRoutes.scala:75`) — name it, and
   say whether the gallery fetches per-card (N+1) or in bulk, since the gallery renders one card
   per Output.

### Non-blocking notes

- Task 1.2's verification list omits `GET /api/outputs/:id/rows` and
  `GET /api/outputs/:id/assertion-status`, both of which the ticket's "Inherited backend surface
  (verify each)" lists. Either verify them or state they are unused by this ticket.
- The epic's E2E exit criterion (spec line 256) is **<= 12 interactions** from "New pipeline" with a
  pasted table to three Outputs placed. Task 9.3 only says "record interaction count". Recording
  it against the stated budget would make the Playwright AC a pass/fail signal rather than a
  measurement; worth adopting even though the ticket AC does not demand it.
- `pipeline-editor-page`'s MODIFIED requirements keep their original (now-misleading) requirement
  headers, e.g. "Bound-type bar displays the pipeline's output DataType" whose body says the
  DataType field is removed, and "Run pipeline button shows placeholder" whose scenario is titled
  "Run button shows placeholder on click" but asserts a real SSE run. That is the OpenSpec
  MODIFIED convention working as intended for header stability, but the scenario *titles* under
  them are now false statements; renaming the scenarios would cost nothing.
