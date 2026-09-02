## Skeptic Report — design gate (round 4, skeptic-design-4.md)

**Round 4 of a 5-round budget.** Verdict is REFUTE, but see "Weighing the budget" at the end:
the remaining findings are small, mechanical, and do not require re-litigating any prior round's
decision.

### What I verified (with evidence)

Read in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all 8 spec deltas,
`skeptic-design-3.md`. Every backend claim below was checked against the source in **this
worktree**, not against another agent's narrative.

Round-3 resolution (the enum/fieldRef change request) — **consistent, accepted**:
- `backend/src/main/scala/com/helio/domain/shapes/ShapeParamDescriptor.scala:16-22` — exactly five
  fields (`name, label, dataType, required, description`); no `enum`/`fieldRef`. Design decision 13's
  citation is accurate to the line.
- `PipelineShapeProtocol.scala:129-134` — `jsonFormat1(ExpandPipelineShapeRequest)` (params only, no
  `parentStepId`), `jsonFormat2(ExpandPipelineShapeResponse)`. Decisions 11 and 14 are accurate.
- `PipelineShapeProtocol.scala:92` — `fromDomain(...) = ExpandPipelineShapeResponse(steps = ..., outputs = None)`
  hardcoded: the dormant-outputs claim is literally true on the shipped backend.
- Four-way agreement confirmed by direct read: design.md decision 13 (dormant/forward-compatible,
  HEL-731 only partially absorbed, follow-up filed at delivery), `specs/pipeline-shape-instantiation-ui/spec.md:30-48`
  (both enum/fieldRef scenarios relabeled "fixture-only until the backend descriptor gains ..."),
  tasks.md 6.2 ("forward-compatible only ... file a backend follow-up"), proposal.md:19-22
  ("**partially** absorbed -- the widget half ships, the backend descriptor extension does not").
  **Nothing anywhere still asserts enum/fieldRef as a live path.** This finding is closed.

Other backend ground truth re-derived (all plan claims hold):
- `CreatePipelineRequest` (`api/protocols/pipelines/PipelineProtocol.scala:36-42`) — `name`,
  `sourceDataSourceId`, `tag`, `steps`, `outputs`; no inline-source arm. Decision 10 and
  `pipeline-new-flow/spec.md`'s two-calls-for-a-new-source requirement are correct.
- Routes exist as planned: `pipelines/:id/outputs` (`OutputRoutes.scala:31`), `outputs/:id/panels`
  (`:75` — decision 9's citation is exact), `/assertion-status` (`:80`), `/rows` (`:88`),
  `GET /api/outputs` (`:109`), `pipelines/:id/steps` (`PipelineStepRoutes.scala:21`),
  `capabilities?stepId=` (`PipelineRoutes.scala:59`), `POST pipelines/:id/preview` with
  `parameters("outputId".optional)` (`PipelineRunStatusRoutes.scala:53-58`).
- `parentStepId: Option[...]` is flat on every step case class and on `PipelineAnalyzeService`'s
  node input (`:159`, `:185` groups by it) — decision 1's client-side `buildStepTree` premise holds.

AC coverage traced ticket → tasks: Playwright flow → 9.3; Jest set → 9.1; 676/878/681 repros → 9.2;
mobile 375/430 → 3.6; paste-a-table/HEL-723 → 7.2; e2e grep + openspec → 9.4/10.1/10.2;
lint/typecheck/test + 400-line + no-dataTypeId → 10.3/10.4/10.5. No AC is uncovered.

### Verdict: REFUTE

### Change Requests

1. **`specs/pipeline-output-sheet/spec.md`, "Live preview reflects current unsaved config", is not
   implementable against the shipped preview endpoint as written.** `PipelineRunService.previewOutputs`
   (`services/pipelines/PipelineRunService.scala:284-298`) resolves `outputId` via
   `outputRepo.findById(id, user)` and then returns `previewAtNode(pipelineId, output.node.stepId, ...)`.
   Two consequences the plan never states:
   (a) the response is **node rows only** — the Output's config is never applied server-side, so no
   server call can "reflect the unsaved config"; the in-progress config must be applied client-side
   by the renderer over those rows;
   (b) it requires a **persisted** Output (`findById` → `NotFound` otherwise), so a brand-new Output
   being composed in the sheet before first save has no `outputId` and cannot use this endpoint at all.
   Required revision: state the actual mechanism in design.md (a new numbered decision) and rewrite
   that requirement + its "Preview updates after changing chart type" scenario to say: rows come from
   `POST /api/pipelines/:id/preview?outputId=` for a saved Output and from the existing
   `GET /api/pipelines/:id/steps/:stepId/preview` (`PipelineRunStatusRoutes.scala:48-52`) for an
   unsaved/not-yet-created one, with the in-progress config applied client-side at render time.
   Reflect the same in tasks.md 5.5 (currently "Live preview wired to `POST .../preview?outputId=`,
   debounced" — which alone would leave the new-Output case with no preview source).

2. **Dangling cross-reference to a nonexistent "decision 12", twice.** design.md:88 ("same posture as
   decision 12's dormant Outputs arm") and tasks.md 6.3 ("implement the arm per design.md decision 12")
   both point at a decision number that does not exist in design.md — the dormant-Outputs decision is
   **14**. Fix both to 14.

3. **Two different "decision 14"s are in play with no disambiguation.** design.md item 4 and ticket.md
   line 30 use "decision 14" to mean the *binding spec doc*'s decision 14 (markdown Output kind), while
   design.md's own list numbers the dormant-shape-Outputs decision 14. Qualify the references in
   design.md item 4 (and tasks.md 5.4, which inherits it) as e.g. "spec decision 14" so an implementer
   reading design.md cannot resolve it to the wrong item.

4. **`specs/pipeline-tails-ui/spec.md`, "Tail renders as an indented dashed chain", contradicts
   design.md decision 1 on how a tail continues.** The requirement reads "SHALL render that child, and
   any further **position ≥ 1** descendants, as an indented dashed mini-chain", but decision 1 defines a
   tail as "any child reached through a position ≥ 1 edge, **plus that child's own descendants**" —
   which, per the same decision's Phase-1 invariant, are reached through position-**0** edges. Taken
   literally the spec renders a one-step tail and drops the rest of the chain. Reword to "that child and
   all of its descendants" (matching decision 1 and the requirement's own "a tail's leaf step" scenario).

### Non-blocking notes

- design.md's decision list is out of numeric order (1,2,3,4,5,11,13,14,6,7,8,9,10). Harmless, but
  renumbering (or at least sorting) would prevent a recurrence of finding 2.
- proposal.md:23 still says "single-call `POST /api/pipelines`" for the new-pipeline flow. This is
  reconciled explicitly by design.md decision 10 and by `pipeline-new-flow/spec.md`, so it is not a
  contradiction — but a parenthetical "(pipeline creation itself; a brand-new source is created first)"
  would remove the last place a reader could be misled.

### Weighing the budget (round 4 of 5)

None of the four change requests reopens a settled decision or requires new investigation: #2, #3 and
#4 are one-line documentation edits, and #1 is a scoped correction naming the exact endpoint to use for
the unsaved case. I would expect a single short revision pass to clear all four, leaving round 5 in
hand. I do not see grounds to escalate.
