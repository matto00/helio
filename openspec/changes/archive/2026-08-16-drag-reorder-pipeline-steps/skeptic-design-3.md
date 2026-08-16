## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 Change Request 1 (Redux thunk wouldn't touch rendered state) — genuinely resolved
at the architecture level.**
- `PipelineDetailPage.tsx:86-87` confirms local `useState<Step[]>([])` + `stepsInitialized`
  gate; `PipelineDetailPage.tsx:129-132` shows the once-only seed from `persistedSteps`
  (`stepsInitialized` never resets — confirmed no other `setStepsInitialized(false)` call site
  exists in the file besides the three `true` sites at lines 130, 295, 326).
- Design.md's Context (lines 15-24) and Decision 7 now correctly state page-local ownership and
  propose `handleReorderSteps` as a page-local handler mirroring `handleRemoveStep`
  (`PipelineDetailPage.tsx:348-359`) / `handleStepConfigChange` (344-346) — local `setSteps` +
  plain service call, no thunk. `proposal.md`'s Impact section confirms "No Redux slice changes."
  This matches the established pattern exactly.
- `PipelineRiverView.tsx:95` (`steps.map((step, idx) => ...)`) confirms `idx` is already
  available for the drag/Move-button wiring Decision 5 depends on.
- However, see new finding 1 below — the reconciliation step of the very same Decision 7 is
  internally inconsistent with itself, and new finding 2 shows tasks.md still contains one
  stale reference to the rejected thunk approach.

**Round-2 Change Request 2 (`step.position` doesn't exist on the UI `Step` type) — genuinely
resolved.**
- `frontend/src/features/pipelines/types/step.ts:21-26` confirms `Step` has only `id`, `opType`,
  `label`, `config` — no `position`.
- `stepNarrowing.ts:226-237` (`pipelineStepToStep`) confirmed to not copy `ps.position` into the
  returned `Step`.
- Decision 9 now correctly avoids `step.position` and uses the list index instead
  (`stepIndex: number` prop, fingerprint `` `${stepIndex}:${JSON.stringify(step.config)}` ``).
  `StepCard.tsx:119` (`const configFingerprint = JSON.stringify(step.config);`) confirms this is
  exactly the fingerprint variable being extended, and the spec delta's wording
  ("the step's position in the editor's step list changes (reorder)") matches. Genuinely
  resolved.

**Round-1 resolutions still intact.**
- `StepCard.tsx:231-252` still shows the single native `<button>` header (icon/label/count/
  chevron, `onClick=handleHeaderClick`, `aria-expanded`) that Decision 4's restructure targets —
  unchanged from round 1/2's verification.
- `SidebarItemList.tsx:58-67` docstring and `SidebarItemList.tsx:182,222-223` render still show
  the sibling-row-action precedent (`dashboard-list__item-row` wrapper + sibling
  `dashboard-list__row-action` span) Decision 4 cites verbatim. Unchanged.
- Backend Context claims re-verified directly: `PipelineService.scala:255-258`
  (`proposal.steps.zipWithIndex` reindex on bulk create), `PipelineService.scala:629-652`
  (`deleteStep` → `deleteInternal`, no renumbering of survivors),
  `PipelineStepRepository.scala:73/104/123/162/186` (existing `.transactionally` usage,
  confirming Decision 2's proposed `reorderInternal` transactional pattern is consistent with
  the codebase). All accurate.

### Review on the merits — new findings

1. **Decision 7(d)'s reconciliation formula contradicts its own claim about local-only temp
   steps — a real, specified-but-wrong mechanism, not just imprecise wording.**
   Design.md lines 92-97: "(c) ... `orderedIds` = the persisted step ids ..., excluding
   local-only `step-N` temp ids ...; (d) on success, reconcile via
   `setSteps(response.map(pipelineStepToStep))` — authoritative order, same relative sequence,
   **so no visible churn (temp steps, if any, are re-appended in their local spots — executor
   keeps this deterministic)**."
   `response` is the reorder endpoint's return value — per Decision 1, "the full reordered step
   list" of the *pipeline's persisted steps* (set-equality validated against `orderedIds`, which
   already excludes temp ids). A temp step (created via `handleAddStep`, `PipelineDetailPage.tsx:
   293-314`, while its `createPipelineStep` POST is still in flight or has failed — the existing
   comment at line 305 confirms temp steps are kept exactly for this reason) is therefore **never
   present in `response`**. Literally executing `setSteps(response.map(pipelineStepToStep))`
   drops any temp step from the rendered list entirely — the opposite of "re-appended in their
   local spots." The parenthetical "executor keeps this deterministic" does not supply an actual
   algorithm; it defers a genuine implementation decision (how to interleave the untouched temp
   entries back into their prior relative positions against the freshly-ordered persisted
   entries) without specifying one. This is exactly the "decisions deferred that block
   implementation" pattern this gate exists to catch — it can plausibly occur (drag-reorder while
   an add-step POST is still resolving or has failed and the temp card is still visible), and as
   written an implementer following the formula verbatim ships a step-vanishes-after-reorder bug,
   while an implementer who notices the gap has no specified merge strategy to follow.
   A specifiable fix exists and should be written into the decision instead of hand-waved: since
   the optimistic `newOrder` (step (b)) already encodes the correct final relative position of
   every entry including temp ones, reconcile by mapping over `newOrder` and replacing each
   *persisted* entry with the corresponding entry looked up by id from `response` (via
   `pipelineStepToStep`), leaving temp entries in `newOrder` unchanged — never discarding
   `newOrder` wholesale in favor of `response` alone.

2. **Task 3.2 retains a stale "the thunk" reference that contradicts the revised Decision 7.**
   `tasks.md:24`: "reorder dispatches the thunk" — but design.md now explicitly rejects a Redux
   thunk (Decision 7's own heading: "State flow — page-local handler, NOT a Redux thunk";
   Context line 20: "No step mutation goes through a Redux thunk"; proposal.md line 23: "not a
   thunk"). `grep -rn -i thunk` across `design.md`/`proposal.md`/`tasks.md`/`specs/` confirms this
   is the **sole** remaining reference to a thunk anywhere in the revised artifact set — every
   other mention correctly states there is no thunk. This is a leftover from the pre-round-2
   draft that round 2's required task revisions (which named only 2.2 and 3.1) did not sweep up.
   It is a direct, checkable "tasks contradict design" case per this gate's own adversarial
   checklist, even though its blast radius is narrow (a single test-task line, most likely
   self-evident to an implementer reading the rest of the document) — left as-is it is still an
   internal contradiction in the artifact an implementer is instructed to follow verbatim.

### Verdict: REFUTE

Both round-2 change requests are genuinely resolved at the architectural level the round-2 report
demanded (page-local state ownership; list-index-based fingerprint instead of a nonexistent
`position` field), and all round-1 resolutions remain intact on re-verification. However, a fresh
pass over the revised Decision 7 — the same decision that was the subject of round 2's REFUTE —
surfaces a self-contradiction in its own reconciliation formula (claims temp steps survive a
successful reorder; the literal formula given drops them), plus one leftover stale "thunk"
reference in tasks.md that the round-2 revision's task updates (2.2, 3.1) didn't fully sweep. Both
are narrow, quick-to-fix textual/specification gaps — not new architectural rework — but per this
gate's mandate ("decisions deferred that block implementation," "tasks contradict design") they
are real and should be closed before execution rather than left for undocumented improvisation
mid-implementation.

### Change Requests

1. Revise Decision 7(d) in `design.md` to specify a reconciliation formula that actually preserves
   local-only temp steps, e.g.: map over the optimistic `newOrder` (from step (b)) and replace
   each *persisted* entry with its corresponding `response` entry (looked up by id, narrowed via
   `pipelineStepToStep`), leaving any temp (`step-N`) entries in `newOrder` untouched — rather than
   `setSteps(response.map(pipelineStepToStep))`, which discards local-only temp steps outright
   since they are never present in `response` (excluded from `orderedIds` per step (c), and the
   reorder endpoint's response is scoped to the pipeline's persisted steps per Decision 1). Update
   Task 3.1 if it needs a case covering "temp step present during a reorder does not disappear
   from view."
2. Fix `tasks.md:24` — remove/replace "reorder dispatches the thunk" (Task 3.2) so it matches
   Decision 7's page-local-handler-not-a-thunk mechanism (e.g. "reorder invokes the
   `onReorderSteps`/`handleReorderSteps` callback with the correct new order" or similar,
   consistent with how Task 3.1 already describes it). Confirmed via `grep -rn -i thunk
   design.md proposal.md tasks.md specs/` that this is the only remaining stray reference.

### Non-blocking notes

- (Carried from round 2, still open) `PipelineRiverView`'s props interface
  (`PipelineRiverView.tsx:17-36`) does not yet list an `onReorderSteps`/equivalent callback; only
  implied by Task 2.2's "thread it into PipelineRiverView." Worth stating explicitly in Decision
  7's text once Change Request 1 above is resolved, though not blocking on its own.
