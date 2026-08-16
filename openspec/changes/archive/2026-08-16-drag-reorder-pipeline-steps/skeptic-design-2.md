## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 Change Request 1 (header DOM restructure) — RESOLVED.**
- `StepCard.tsx:227-252` confirms the pre-existing state exactly as design.md's Context/Decision 4
  describe: the whole header (icon/label/count/chevron) is one native
  `<button onClick={handleHeaderClick} aria-expanded={expanded}>`.
- design.md Decision 4 now specifies the fix precisely: wrapper `<div>`, the existing toggle
  `<button>` kept with unchanged content/semantics (`flex: 1`), plus a sibling actions cluster
  (drag handle + Move up/down).
- The cited precedent checks out verbatim: `SidebarItemList.tsx:58-67`'s `renderRowAction` docstring
  ("a genuine sibling element, not nested inside the row's own `<button>` ... needs no
  `stopPropagation()`"), and the actual render at `SidebarItemList.tsx:181-224` shows exactly that
  shape — `<div className="dashboard-list__item-row">` wrapping the selectable `<button>`/`<NavLink>`
  plus a sibling `<span className="dashboard-list__row-action">{renderRowAction(item)}</span>`.
  Decision 4's plan matches this pattern faithfully.
- Tasks 2.3 and 3.2 (regression guard: "Move clicks don't toggle expand," "toggle keeps
  aria-expanded/keyboard") cover implementation and verification. Sizing corrected honestly
  ("~30-40 lines," not "buttons wiring") in Planner Notes, with the over-400-line growth
  acknowledged and deferred to HEL-682. Genuinely resolved.

**Round-1 Change Request 2 (cross-component drag wiring) — RESOLVED.**
- `PipelineRiverView.tsx:96` confirms the wrapper div this decision is about:
  `<div key={step.id} className="pipeline-detail-page__step-section">` sibling to `StepCard`.
- Decision 5 now picks explicitly: props, not className coupling — `onStepDragStart(index)` /
  `onStepDragEnd()` passed down to `StepCard` (wired to the handle's native `onDragStart`/`onDragEnd`),
  while `onDragOver`/`onDrop`/`overIndex`/drop-indicator stay on `PipelineRiverView`'s own
  `pipeline-detail-page__step-section` wrapper divs — which is architecturally sound native-HTML5-DnD
  (dragstart fires on the actual draggable source; dragover/drop listen on the ancestor drop-target
  divs). No `event.target.closest()` cross-component className coupling. Task 2.4 matches. Genuinely
  resolved.

**Non-blocking note 1 (Context reindex claim) — RESOLVED.** Context now correctly states bulk
creation reindexes but `deleteStep` does not renumber survivors, and the reorder endpoint always
full-reindexes 0..n-1. Matches round-1's verified ground truth (`PipelineService.scala:629-652`).

**Non-blocking note 2 (`state.steps[pipelineId]`) — RESOLVED at the text level**, but this is exactly
adjacent to a new, more serious problem found below: fixing the Redux-path reference doesn't help
because the Redux path isn't what the page actually renders from (see Change Request 1).

### Review on the merits — new findings (not previously raised)

I traced Decision 7 (state flow) and Decision 9 (preview-refresh fingerprint) against the actual
rendering path, since these are exactly the kind of "decisions deferred that block implementation"
this gate exists to catch, and found two concrete, code-verified problems the round-2 revision did
not address (they weren't part of round 1's change requests, so revising for round 1 didn't touch
them):

1. **Decision 7's Redux-thunk reorder plan does not wire to the component that actually renders the
   step list.** `PipelineDetailPage.tsx:462` passes `steps={steps}` to `PipelineRiverView`, where
   `steps` is **local component state** (`useState<Step[]>([])`, line 86) — not the Redux-selected
   `reduxSteps`/`persistedSteps` (lines 69, 84). Those Redux-sourced values are read exactly once,
   gated by `stepsInitialized` (lines 129-132), to seed local `steps` on first load; `stepsInitialized`
   never resets to `false` again for the life of the component (`grep -n setStepsInitialized` shows
   only three call sites, all `true`). Every other step mutation in this file —
   `handleAddStep` (293-314), `handleInstantiateShape` (324-342), `handleStepConfigChange` (344-346),
   `handleRemoveStep` (348-359) — mutates the **local** `steps` state directly via `setSteps` and
   persists through **plain async calls into `pipelineService.ts`** (`createPipelineStep`,
   `deletePipelineStep`), never through a Redux thunk. This is the codebase's established, consistent
   pattern for this page.
   Design.md Decision 7 instead proposes a `reorderPipelineSteps` `createAsyncThunk` whose
   pending/fulfilled/rejected reducers touch only `state.steps[pipelineId]` in the Redux slice
   (`pipelinesSlice.ts:349` is the only place that key is written, via `fetchPipelineSteps.fulfilled`).
   Dispatching that thunk as designed would update Redux state that `PipelineDetailPage` never reads
   again post-init — `PipelineRiverView`'s rendered order would **not change** after a drag-drop or a
   Move-button click. That's not a corner case; it defeats the ticket's primary goal ("drag + keyboard
   reorder" — a visible UI reorder), and it's the opposite of what round 1 confirmed as sound ("state
   flow" was not itself scrutinized in round 1, only the fingerprint mechanics downstream of it).
   Required: design.md must pick one of:
   (a) match the established local-state pattern — a new handler in `PipelineDetailPage.tsx`
       (e.g. `handleReorderSteps`) that optimistically reorders the **local** `steps` array and calls
       a plain `reorderPipelineSteps(pipelineId, stepIds)` service function directly (mirroring
       `handleRemoveStep`/`handleStepConfigChange`, not a Redux thunk), reconciling the server
       response into local state on success and reverting/refetching-and-reinitializing on failure; or
   (b) explicitly widen scope so `PipelineDetailPage`'s local `steps` continuously derives from Redux
       `reduxSteps` post-init, and justify why that's safe given local-only temp steps (`makeStep`,
       id prefix `step-`) that don't exist in Redux and would need to survive a resync.
   Tasks 1's slice/thunk tasks (2.2) and the slice-only tests (3.1) need to change to match whichever
   path is chosen; `PipelineRiverView`'s prop interface likely needs a new `onReorderSteps` callback
   up to the page, which nothing in tasks.md currently adds.

2. **Decision 9 / Task 2.6 references `step.position`, a field that does not exist on the `Step` type
   `StepCard` actually receives, and calls the change "one line."**
   `frontend/src/features/pipelines/types/step.ts:20-25` — `Step` has only `id`, `opType`, `label`,
   `config`; no `position`. `StepCard.tsx:71` types its `step` prop as this `Step` (not the wire
   `PipelineStep`, which does carry `position` — `pipelineStep.ts:152`/`311`).
   `stepNarrowing.ts:226-237` (`pipelineStepToStep`) is the sole conversion from wire `PipelineStep` to
   UI `Step` and explicitly does not copy `ps.position` into the returned object. Confirmed via
   `grep -rn "\.position\b" frontend/src/features/pipelines/` (excluding tests): zero hits today —
   `position` is entirely absent from the UI-facing step model already.
   `` `${step.position}:${JSON.stringify(step.config)}` `` as written would be a TypeScript compile
   error (`Property 'position' does not exist on type 'Step'`), not a working fingerprint.
   Required: design.md must add `position: number` to the `Step` interface, update
   `pipelineStepToStep` to carry it through, and — tied to Change Request 1 — specify how the local
   `steps` array gets correct, fresh position values after a client-side reorder (since the render
   path is local state, not the server-returned Redux list, until the persisted response arrives).
   This is materially more than "one line"; the task/sizing should say so.

Both problems trace back to the same root cause: design.md's Context section says "PipelineRiverView.tsx
owns the step list rendering" but never traces that ownership one level further up to
`PipelineDetailPage.tsx`'s local `steps` state, which is the actual source of truth `PipelineRiverView`
renders from. Decision 7 was written as if `PipelineRiverView`/Redux were the state owner; ground truth
says otherwise.

### Verdict: REFUTE

Both round-1 change requests are genuinely resolved on their own merits, verified against the actual
`StepCard.tsx`, `SidebarItemList.tsx`, and `PipelineRiverView.tsx` code. However, independently tracing
the revised design's state-flow decision (7) and preview-refresh decision (9) against
`PipelineDetailPage.tsx`'s actual rendering path surfaces a new, blocking architectural gap: the
proposed Redux-thunk reorder mechanism does not update the state `PipelineRiverView` actually renders
from (local component state, not Redux), and the preview-refresh fingerprint references a field
(`step.position`) that doesn't exist on the type in scope. Left as-is, an implementer following
design.md/tasks.md verbatim would ship a reorder that either doesn't visibly work or requires
undocumented improvisation mid-execution — precisely what this gate exists to catch before an
execution cycle burns on it.

### Change Requests

1. Revise Decision 7 (and Task 2.2, and add a `PipelineRiverView`/`PipelineDetailPage` wiring note) to
   specify how a reorder actually updates the `steps` array `PipelineRiverView` renders, given that
   array is `PipelineDetailPage.tsx`'s local `useState<Step[]>` (`PipelineDetailPage.tsx:86`), not the
   Redux slice's `state.steps[pipelineId]` (which is read only once at init,
   `PipelineDetailPage.tsx:129-132`, and never resynced). Pick and document one of: (a) a local-state
   handler + direct service call mirroring `handleRemoveStep`/`handleStepConfigChange`
   (`PipelineDetailPage.tsx:344-359`), or (b) a justified refactor to make local `steps` derive
   continuously from Redux, accounting for local-only temp steps. Add whatever new prop
   (`PipelineRiverView` → `PipelineDetailPage`) this requires to its documented interface.
2. Revise Decision 9 (and Task 2.6) to add `position: number` to the `Step` interface
   (`frontend/src/features/pipelines/types/step.ts:20-25`), thread it through
   `pipelineStepToStep` (`stepNarrowing.ts:226-237`), specify how the locally-reordered array gets
   correct position values before the server response lands (tied to Change Request 1's chosen
   mechanism), and correct the "one-line change" sizing claim in Task 2.6 / Planner Notes.

### Non-blocking notes

- Once Change Request 1 is resolved, re-check whether `PipelineRiverView`'s existing props list
  (`PipelineRiverView.tsx:17-36`) needs a new callback prop documented in design.md's Decision 5/7
  text, not just implied by tasks.md.
