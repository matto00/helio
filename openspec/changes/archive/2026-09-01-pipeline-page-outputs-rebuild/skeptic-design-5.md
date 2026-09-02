## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

Re-verification of round 4's four change requests, cold against backend source:

1. **CR#1 — output-sheet live preview mechanism.** VERIFIED FIXED and grounded.
   - `PipelineRunStatusRoutes.scala:48` exposes `GET /api/pipelines/:id/steps/:stepId/preview`
     (`previewStep`); `:53-56` exposes `POST /api/pipelines/:id/preview` with optional `outputId`.
   - `PipelineRunService.previewOutputs` (`:284-317`) resolves `outputId` via
     `outputRepo.findById`, 404s when absent, and delegates to `previewAtNode` — it returns node
     rows and never applies Output config server-side. Design decision 6a's claim is exactly true.
   - design.md decision 6a, `pipeline-output-sheet/spec.md`'s "Live preview reflects current
     unsaved config" requirement + both scenarios, and tasks.md 5.5 now all state the same
     two-endpoint / client-side-apply mechanism. Implementable as written.

2. **CR#2 — dangling "decision 12" references.** PARTIALLY FIXED. tasks.md 6.3 now correctly says
   "decision 14". But `design.md:88` still reads "same posture as decision 12's dormant Outputs
   arm" — there is no decision 12 in design.md (decisions present: 1,2,3,4,5,11,13,14,6a,6,7,8,9,10).
   The referent is unambiguously decision 14 ("Shape-declared Outputs are dormant..."). Downgraded
   to a non-blocking note — see below.

3. **CR#3 — "decision 14" namespace collision.** VERIFIED FIXED. design.md:59 now reads
   "Markdown Output kind (binding spec decision 14)"; tasks.md 5.4 reads "(binding spec decision
   14)". No remaining ambiguity between design.md's own decision 14 and the binding spec's.

4. **CR#4 — tail-rendering contradiction.** VERIFIED FIXED. `pipeline-tails-ui/spec.md`'s first
   requirement now reads "A step with a position >= 1 child SHALL render that child and all of its
   descendants (reached ... through position-0 edges from that child)", which matches design.md
   decision 1 ("a tail is any child reached through a position >= 1 edge, plus that child's own
   descendants") word for word in substance.

Non-blocking fix from round 4: proposal.md:24-25 now carries "(pipeline creation itself; a
brand-new source is created first, see design.md decision 10)". Consistent with decision 10 and
with `pipeline-new-flow/spec.md`'s two-call requirement.

Independent re-grounding of the plan's backend claims (all confirmed against merged P1.1–P1.4
source at `e8bb4396`):
- `CreatePipelineRequest` = `(name, sourceDataSourceId, tag?, steps, outputs)`
  (`PipelineProtocol.scala:36-42`) — `sourceDataSourceId` required, no inline-source arm.
  Decision 10 and `pipeline-new-flow` are correct.
- `PipelineSummaryResponse` (`:44-50`) carries no `outputs`/`steps` — decision 2's "fetched
  separately" is correct.
- `ExpandPipelineShapeRequest(params: JsObject)` and
  `ExpandPipelineShapeResponse(steps, outputs: Option[JsArray] = None)`
  (`PipelineShapeProtocol.scala:53,88`) — decisions 11 and 14 correct: no `parentStepId` field,
  outputs dormant.
- `ShapeParamDescriptor` has exactly five fields (`name,label,dataType,required,description`) —
  decision 13's "HEL-731 only partially absorbed" is correct and honestly stated.
- `CreatePipelineStepRequest` has `parentStepId: Option[String]`
  (`PipelineStepProtocol.scala:167-173`) and the create route is
  `POST /api/pipelines/:id/steps` (`PipelineStepRoutes.scala:21`) — decision 5 / tasks 5.6 correct.
- `OutputRoutes.scala`: `pipelines/:id/outputs` (:31), `outputs/:id` (:54), `panels` (:75),
  `assertion-status` (:80), `rows` (:88), lean `GET /api/outputs` (:109) — decisions 2 and 9 correct.
- Capabilities-at-node at `PipelineRoutes.scala:59-62` — correct.

Full final pass over ticket.md, proposal.md, design.md, tasks.md and all 8 spec deltas:
- AC coverage traces cleanly: AC1→9.3, AC2→9.1, AC3→9.2, AC4→3.6, AC5→7.2 + 1.4, AC6→9.4/10.1/10.2,
  AC7→10.3/10.4/10.5. Scope items map to tasks 3.x/4.x/5.x/6.x/7.x/8.x with no orphan and no task
  outside the ticket's scope.
- No TODO/TBD/"figure out later" anywhere in the artifacts. Every deferral (HEL-731 descriptor half,
  shape-declared Outputs, inline-source arm) names a concrete follow-up and a reason.
- No remaining internal contradictions between proposal/design/tasks/deltas that I could find.

### Verdict: CONFIRM

The plan is sound, internally consistent, and grounded in the real merged backend. Every mechanism
it depends on exists at the path it names; every place the binding spec's literal wording diverges
from the shipped contract (decisions 10, 13, 14) is called out explicitly rather than silently
redefined. Nothing here requires reopening a settled decision, so no escalation is warranted.

### Non-blocking notes

- `design.md:88` — "same posture as decision 12's dormant Outputs arm" should read
  "decision 14". Residual from round 4's CR#2 (tasks.md was fixed, design.md's own second
  occurrence was not). Purely a cross-reference typo: decision 13's surrounding text fully states
  the forward-compatible posture on its own, so no implementation ambiguity results. Fix in passing
  during execution.
- `pipeline-editor-page/spec.md` — the MODIFIED "Run pipeline and Dry run buttons" requirement
  keeps its original scenario name "Run button shows placeholder on click" while the scenario body
  now asserts a real SSE run. Preserving the name is likely deliberate (OpenSpec matches MODIFIED
  scenarios by name), but the name now reads as the opposite of its body; consider renaming if the
  tooling permits.
- `pipeline-output-type-selector/spec.md`'s Migration note says consumers read
  "`state.outputs`/`currentPipeline.outputs`". `currentPipeline.outputs` is a client-side derived
  shape only — design.md decision 2 correctly establishes the wire has no such field. Worth a word
  so nobody reads it as a wire claim.
- Ticket's inherited-surface list includes `GET /api/outputs/:id/assertion-status`,
  `POST /api/pipelines/:id/validate-expression`, and `GET /api/outputs/:id/rows`. tasks.md 1.2
  verifies they exist, but no task consumes them in the UI. The ticket lists them under "verify
  each" rather than as scope, so this is consistent — just confirming it is deliberate.
