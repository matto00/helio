## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Batch-endpoint justification (ticket's pre-authorized branch)** — CONFIRMED sound.
   - `backend/src/main/scala/com/helio/services/PipelineService.scala:555` (`updateStep`) calls
     `pipelineStepRepo.updateInternal(stepId, config = None, position = req.position)`.
   - `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala:167-187`
     (`updateInternal`) writes `position.getOrElse(row.position)` as a raw value with no sibling
     shifting, wrapped in its own `ctx.withSystemContext(action.transactionally)` — i.e. one
     transaction *per HTTP request*, not across a multi-step reorder sequence.
   - Confirmed no `UNIQUE(pipeline_id, position)` constraint exists
     (`backend/src/main/resources/db/migration/V23__pipeline_steps.sql`), so the design's planned
     `DBIO.sequence(...).transactionally` of per-id position updates inside one batch transaction
     will not hit a mid-transaction constraint violation from transient duplicate positions — a
     real gotcha the design correctly avoided walking into.
   - Conclusion: the "per-step PATCH proves insufficient for a clean atomic reorder" bar is met on
     ground truth; the additive `PUT /api/pipelines/:id/steps/order` is genuinely warranted, not
     scope creep.

2. **Batch-endpoint spec correctness** — CONFIRMED matches existing patterns.
   - ACL pattern (owner-or-`requireEditorAccess`, `findByIdShared`-driven NotFound masking) mirrors
     `updateStep`/`deleteStep` exactly (`PipelineService.scala:532-544`, `634-650`).
   - No routing collision: `PipelineStepRoutes.scala`'s `pathPrefix("pipelines"/id/"steps")` only
     handles `pathEndOrSingleSlash` today; the sibling `pipelines/:id/steps/:stepId/preview` route
     lives in a separate `PipelineRunStatusRoutes.scala` under a different `pathPrefix` shape — a
     new literal `path("order")` branch under the `steps` prefix doesn't shadow or get shadowed by
     either (confirmed via `ApiRoutes.scala:522-538` composition order).
   - `listSteps` (`PipelineService.scala:424-433`) already returns `Vector[PipelineStepResponse]`
     with no dedicated response schema in `schemas/` (`ls schemas/ | grep step` → empty) — so the
     design's "response = same shape as GET .../steps, no new response schema" claim is correct;
     only the new `ReorderPipelineStepsRequest` needs a schema.
   - `check-schema-drift.mjs` matches schemas to case classes by `title`, not filename — the
     proposed `reorder-pipeline-steps-request.schema.json` (title `ReorderPipelineStepsRequest`)
     will satisfy `check:schemas` as designed.
   - Existing precedent for a viewer-grant ACL test fixture (raw SQL grant insert) is present in
     `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala:589`, so the planned
     403-viewer backend test is achievable with existing test infra.

3. **No-new-dependency frontend choice** — CONFIRMED.
   - `frontend/package.json` has no dnd/drag library (`grep -n "dnd\|drag"` → no hits).
   - `PipelineRiverView.tsx:95-110` confirms the `steps.map` + `RibbonSegment`-between-cards
     structure the design assumes.

4. **Refresh-is-free claims** — CONFIRMED.
   - `PipelineDetailPage.tsx:175-177`: `stepsFingerprint = steps.map((s) => \`${s.id}:${s.opType.id}:${JSON.stringify(s.config)}\`).join("|")` — order-sensitive by construction (array
     order feeds `.map`/`.join`), so a pure reorder (same ids/configs, new order) changes the
     fingerprint and the existing 300ms-debounced analyze effect (`178-185`) re-fires with zero
     additions, as claimed.
   - `StepCard.tsx:118-161`: the HEL-404 preview-refresh effect is keyed on `configFingerprint`
     (currently `JSON.stringify(step.config)`, line 119) via a ref-tracked "last fetched
     fingerprint" pattern; the dependency array already includes the fingerprint variable, so
     widening its computation to `` `${step.position}:${JSON.stringify(step.config)}` `` composes
     transparently with the existing debounce/activation logic exactly as Decision 8 describes —
     no duplicate mechanism, no dependency-array changes needed.

5. **Schema/position-reindex obligations** — CONFIRMED, one minor factual overstatement (see notes).

### Verdict: REFUTE

The backend design (the core judgment call this review was asked to scrutinize hardest) is sound
and well-grounded. The frontend interaction design has a real, unaddressed structural conflict
that a competent implementer would either get wrong (invalid nested interactive elements with a
concrete click-bubbling bug) or have to resolve unguided — exactly the kind of gap this gate exists
to catch before an execution cycle burns on it.

### Change Requests

1. **StepCard's header is currently a single native `<button>`; Decisions 4 and 5 both plan to add
   more interactive controls "on the card header" without addressing this.**
   `StepCard.tsx:231-252` renders the *entire* header — icon, label, row count, chevron — as one
   `<button type="button" onClick={handleHeaderClick} ...>` that toggles expand/collapse. Design
   Decision 5 says "Move up / Move down buttons on each card header," and Decision 4 says drag is
   "initiated from the card header area" — both require additional interactive elements to live in
   that same header region. Nesting `<button>` elements inside a `<button>` is invalid content
   model and, concretely in this codebase, would let a click on "Move step up" bubble up and also
   fire `handleHeaderClick`'s expand/collapse toggle (native `click` bubbles; nothing in the design
   calls for `stopPropagation()`).
   The codebase already has an established, documented solution to exactly this problem —
   `frontend/src/shared/chrome/SidebarItemList.tsx:58-67`'s `renderRowAction` prop, whose docstring
   states explicitly: *"A genuine sibling element, not nested inside the row's own `<button>`:
   unlike `renderBadge` (which renders *inside* that button), a clickable control here needs no
   `stopPropagation()` to keep its click from also firing `onSelect`."* Design.md does not reference
   this pattern, does not say the header will be restructured from a single `<button>` into a
   wrapper with sibling controls, and does not say how the existing keyboard/focus/`aria-expanded`
   semantics the native `<button>` currently gets for free will be preserved if the header stops
   being a `<button>`. Required: add a decision to design.md specifying (a) the header's new DOM
   shape (e.g. wrapper `<div>`/`<header>` containing the existing toggle affordance plus
   Move-up/Move-down/drag-handle as true siblings, per the `SidebarItemList` precedent), and (b)
   how expand-toggle keyboard accessibility is preserved once it's no longer a native `<button>`
   wrapping everything. This also affects the Planner Notes' "keep StepCard growth to the
   fingerprint line + header buttons wiring" sizing — a header DOM restructuring is materially more
   than that, and should be sized honestly given the file is already over the 400-line budget.

2. **Cross-component wiring for "drag from header only" is unspecified.** Decision 4 puts the
   `onDragStart/onDragOver/onDrop` listeners "on the card wrapper in `PipelineRiverView`" (i.e. the
   `pipeline-detail-page__step-section` div in `PipelineRiverView.tsx:96`), which is a sibling
   component to `StepCard` — but the header region that should be the sole drag-initiation surface
   lives inside `StepCard`. Design.md doesn't say how the wrapper-level `onDragStart` restricts
   itself to header-originated drags: whether it's (a) an `event.target.closest(...)` check against
   the header's className from the wrapper (no `StepCard` prop changes, but a hardcoded
   cross-component className coupling), or (b) new `StepCard` props threading drag-start/drag-handle
   wiring down (real prop-surface growth, compounding Change Request 1's DOM restructuring).
   Required: design.md should pick one and say so, since it changes both the `StepCard` growth
   estimate and whether `PipelineRiverView` needs an internal knowledge of `StepCard`'s CSS class
   names.

### Non-blocking notes

- design.md's Context section states "`PipelineService` reindexes `position = i` (0-based) in
  existing flows" as a blanket claim. Verified this is true for bulk creation (apply-proposal's
  `zipWithIndex`, `PipelineService.scala:255-258`) but *not* true after `deleteStep`
  (`PipelineService.scala:629-652`), which deletes the row without renumbering survivors, so
  positions can have gaps today. This doesn't affect the reorder endpoint's correctness (it always
  full-permutes and reindexes 0..n-1 from scratch), but the Context claim is an overstatement worth
  tightening so a future reader doesn't rely on "positions are always contiguous" elsewhere.
- Decision 6 says "optimistically reorder `state.steps`" — the actual slice shape is
  `steps: Record<string, PipelineStep[]>` keyed by `pipelineId`
  (`frontend/src/features/pipelines/state/pipelinesSlice.ts:54`), not a flat `state.steps`. Almost
  certainly just shorthand, but worth a one-word fix (`state.steps[pipelineId]`) for precision.
